/**
 * Posing Pollen's Reachy Mini model from the daemon's own state (Virgil, OLV7-32).
 *
 * The robot's URDF is a tree, but the robot is not: the head sits on six rods
 * (a Stewart platform), and the URDF hangs it off the sixth rod only. The
 * daemon reports the motors (`head_joints`: body yaw, then stewart_1..6), the
 * antennas, and where the head is (`head_pose`) - but not the rods' ball
 * joints unless it runs the Placo engine, which the default install does not.
 *
 * So the head is placed directly where the daemon says it is, and each rod is
 * turned about its ball joint until its far end meets its socket on the head
 * (the URDF's `closing_i_1` / `closing_i_2` frames). Nothing here solves
 * kinematics: the daemon already has.
 *
 * Kept free of React and of the page's path aliases, so the tests can run it
 * in Node directly.
 */
import {
  Euler, Matrix4, Object3D, Quaternion, Vector3,
} from 'three';

/**
 * The daemon reports the head lowered by this much (metres) from the URDF's
 * `head` frame - `head_z_offset` in reachy_mini's kinematics data.
 */
export const HEAD_Z_OFFSET = 0.177;

/** The robot's state as the page uses it. Every part is optional: a frame may lack one. */
export interface ReachyState {
  /** Where the URDF's `head` frame is, in the robot's own frame. */
  headPose: Matrix4 | null;
  /** body yaw, then stewart_1..stewart_6 (radians). */
  headJoints: number[] | null;
  /** [left, right] (radians). */
  antennas: [number, number] | null;
  bodyYaw: number | null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numbers(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  return value.every(finite) ? (value as number[]) : null;
}

/**
 * The head pose from the daemon's JSON - a row-major 4x4 `{m: [...16]}`, or
 * `{x, y, z, roll, pitch, yaw}` (scipy's extrinsic "xyz", i.e. Rz*Ry*Rx) -
 * as the URDF `head` frame's matrix, with the daemon's height offset put back.
 */
export function headPoseFrom(raw: unknown): Matrix4 | null {
  if (!raw || typeof raw !== 'object') return null;
  const pose = raw as Record<string, unknown>;
  const m = numbers(pose.m, 16);
  let matrix: Matrix4 | null = null;
  if (m) {
    matrix = new Matrix4().set(
      m[0], m[1], m[2], m[3],
      m[4], m[5], m[6], m[7],
      m[8], m[9], m[10], m[11],
      m[12], m[13], m[14], m[15],
    );
  } else if (['x', 'y', 'z', 'roll', 'pitch', 'yaw'].every((k) => finite(pose[k]))) {
    const rotation = new Quaternion().setFromEuler(
      new Euler(pose.roll as number, pose.pitch as number, pose.yaw as number, 'ZYX'),
    );
    matrix = new Matrix4().compose(
      new Vector3(pose.x as number, pose.y as number, pose.z as number),
      rotation,
      new Vector3(1, 1, 1),
    );
  }
  if (!matrix) return null;
  matrix.elements[14] += HEAD_Z_OFFSET;
  return matrix;
}

/** One frame of the daemon's `/api/state/ws/full` stream, read; null when it is not one. */
export function parseState(raw: unknown): ReachyState | null {
  if (!raw || typeof raw !== 'object') return null;
  const frame = raw as Record<string, unknown>;
  const antennas = numbers(frame.antennas_position, 2);
  const state: ReachyState = {
    headPose: headPoseFrom(frame.head_pose),
    headJoints: numbers(frame.head_joints, 7),
    antennas: antennas ? [antennas[0], antennas[1]] : null,
    bodyYaw: finite(frame.body_yaw) ? frame.body_yaw : null,
  };
  if (!state.headPose && !state.headJoints && !state.antennas && state.bodyYaw === null) {
    return null;
  }
  return state;
}

/** The parts of a loaded URDF robot the pose needs (urdf-loader's URDFRobot has these). */
export interface RobotLike extends Object3D {
  links: Record<string, Object3D>;
  joints: Record<string, Object3D & { setJointValue: (...values: number[]) => boolean }>;
}

interface Rod {
  pivot: Object3D;
  rest: Quaternion;
  tip: Object3D;
  socket: Object3D;
}

export interface ReachyRig {
  robot: RobotLike;
  /** The head's own body (`xl_330`), lifted off the sixth rod and placed directly. */
  head: Object3D;
  /** From the URDF `head` frame back to `xl_330`. */
  headToBody: Matrix4;
  rods: Rod[];
}

const MOTORS = ['stewart_1', 'stewart_2', 'stewart_3', 'stewart_4', 'stewart_5', 'stewart_6'];

/** The robot's own frame matrix of `object` (independent of how the robot is placed in the scene). */
function inRobot(robot: Object3D, object: Object3D): Matrix4 {
  return new Matrix4().copy(robot.matrixWorld).invert().multiply(object.matrixWorld);
}

/**
 * Get a freshly loaded robot ready to be posed. Returns null when the model is
 * not the Reachy Mini this was written for (a part is missing).
 */
export function prepareRig(robot: RobotLike): ReachyRig | null {
  const head = robot.links.xl_330;
  const headFrame = robot.links.head;
  if (!head || !headFrame) return null;
  Object.values(robot.joints).forEach((joint) => {
    if ((joint as unknown as { jointType?: string }).jointType !== 'fixed') {
      joint.setJointValue(0);
    }
  });
  robot.updateMatrixWorld(true);

  const headToBody = inRobot(robot, headFrame).invert().multiply(inRobot(robot, head));
  // The head now hangs from the robot itself, placed each frame from the daemon.
  robot.attach(head);

  const rods: Rod[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const pivot = robot.joints[`passive_${i}_x`];
    const tip = i < 6 ? robot.links[`closing_${i}_1`] : robot.joints.passive_7_x;
    const socket = i < 6 ? robot.links[`closing_${i}_2`] : head;
    if (!pivot || !tip || !socket) return null;
    rods.push({ pivot, rest: pivot.quaternion.clone(), tip, socket });
  }
  return {
    robot, head, headToBody, rods,
  };
}

const tmp = {
  ball: new Vector3(),
  tip: new Vector3(),
  socket: new Vector3(),
  parent: new Quaternion(),
  turn: new Quaternion(),
  matrix: new Matrix4(),
};

function setJoint(robot: RobotLike, name: string, value: number | undefined) {
  if (finite(value)) robot.joints[name]?.setJointValue(value);
}

/**
 * Pose the robot from one state. Returns how far, at most, a rod's end was
 * from its socket before it was turned to meet it (metres) - near zero when the
 * motors and the head agree, which is the check that the model reads the
 * daemon's numbers the right way round.
 */
export function applyState(rig: ReachyRig, state: ReachyState): number {
  const { robot } = rig;
  const joints = state.headJoints;
  setJoint(robot, 'yaw_body', joints ? joints[0] : state.bodyYaw ?? undefined);
  if (joints) MOTORS.forEach((name, i) => setJoint(robot, name, joints[i + 1]));
  if (state.antennas) {
    setJoint(robot, 'left_antenna', state.antennas[0]);
    setJoint(robot, 'right_antenna', state.antennas[1]);
  }
  if (state.headPose) {
    tmp.matrix.multiplyMatrices(state.headPose, rig.headToBody);
    tmp.matrix.decompose(rig.head.position, rig.head.quaternion, rig.head.scale);
  }
  robot.updateMatrixWorld(true);

  let worstGap = 0;
  rig.rods.forEach((rod) => {
    rod.pivot.quaternion.copy(rod.rest);
    rod.pivot.updateMatrixWorld(true);
    rod.pivot.getWorldPosition(tmp.ball);
    rod.tip.getWorldPosition(tmp.tip).sub(tmp.ball);
    rod.socket.getWorldPosition(tmp.socket).sub(tmp.ball);
    const reach = tmp.tip.length();
    const wanted = tmp.socket.length();
    if (reach < 1e-6 || wanted < 1e-6) return;
    // The gap the rod cannot close by turning: its length against the distance.
    const scale = robot.matrixWorld.getMaxScaleOnAxis() || 1;
    worstGap = Math.max(worstGap, Math.abs(reach - wanted) / scale);
    tmp.turn.setFromUnitVectors(tmp.tip.normalize(), tmp.socket.normalize());
    // World turn -> the pivot's own: rest' = P^-1 * turn * P * rest.
    rod.pivot.parent?.getWorldQuaternion(tmp.parent);
    rod.pivot.quaternion
      .copy(tmp.parent).invert()
      .multiply(tmp.turn)
      .multiply(tmp.parent)
      .multiply(rod.rest);
    rod.pivot.updateMatrixWorld(true);
  });
  return worstGap;
}
