// Posing the Reachy from the daemon's state (Virgil, OLV7-32).
// Run: npm run test:virgil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import {
  HEAD_Z_OFFSET, applyState, headPoseFrom, parseState, prepareRig,
} from '../../src/renderer/src/components/reachy/reachy-pose.ts';
import { showsReachy } from '../../src/renderer/src/components/reachy/use-reachy-mode.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('a row-major matrix becomes the URDF head frame, raised by the daemon offset', () => {
  const m = [1, 0, 0, 0.01, 0, 1, 0, 0.02, 0, 0, 1, 0.03, 0, 0, 0, 1];
  const pose = headPoseFrom({ m })!;
  const p = new Vector3().setFromMatrixPosition(pose);
  near(p.x, 0.01);
  near(p.y, 0.02);
  near(p.z, 0.03 + HEAD_Z_OFFSET);
});

test('row-major, not column-major: a rotation reads the right way round', () => {
  // 90 degrees about z: x -> y.
  const m = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const pose = headPoseFrom({ m })!;
  const x = new Vector3(1, 0, 0).transformDirection(pose);
  near(x.x, 0);
  near(x.y, 1);
});

test('x, y, z, roll, pitch, yaw read as scipy extrinsic xyz (Rz Ry Rx)', () => {
  const pose = headPoseFrom({
    x: 0, y: 0, z: 0, roll: 0.3, pitch: -0.2, yaw: 0.5,
  })!;
  const expected = new Matrix4().makeRotationZ(0.5)
    .multiply(new Matrix4().makeRotationY(-0.2))
    .multiply(new Matrix4().makeRotationX(0.3));
  for (let i = 0; i < 12; i += 1) {
    if (i !== 14) near(pose.elements[i], expected.elements[i]);
  }
  near(pose.elements[14], HEAD_Z_OFFSET);
});

test('a frame is read; anything else is not', () => {
  const state = parseState({
    head_pose: { m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    head_joints: [0.1, 1, 2, 3, 4, 5, 6],
    antennas_position: [0.2, -0.2],
    body_yaw: 0.1,
    timestamp: '2026-01-01T00:00:00Z',
  })!;
  assert.deepEqual(state.headJoints, [0.1, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(state.antennas, [0.2, -0.2]);
  assert.equal(state.bodyYaw, 0.1);
  assert.ok(state.headPose);
  assert.equal(parseState(null), null);
  assert.equal(parseState({ timestamp: 'x' }), null);
  // Wrong sizes and non-numbers are dropped, not trusted.
  const partial = parseState({ head_joints: [1, 2], antennas_position: [0, 'a'], body_yaw: 0.4 })!;
  assert.equal(partial.headJoints, null);
  assert.equal(partial.antennas, null);
  assert.equal(partial.bodyYaw, 0.4);
});

test('the robot is shown only when the setting is on AND a robot answers', () => {
  assert.equal(showsReachy({ show: true, answering: true }), true);
  assert.equal(showsReachy({ show: true, answering: false }), false);
  assert.equal(showsReachy({ show: false, answering: true }), false);
  assert.equal(showsReachy({}), false);
  assert.equal(showsReachy(null), false);
});

// --- a small robot shaped like the Reachy's URDF -------------------------------
// A base with six motor joints; on each, a ball joint (passive_i_x) holding a
// rod whose far end (closing_i_1) is ROD from the ball; the head body (xl_330)
// hangs off rod 6 through passive_7_x and carries the sockets (closing_i_2)
// and the `head` frame. At zero every rod end sits in its socket.

const ROD = 0.085;

function joint(name: string, type = 'revolute') {
  const j = new Object3D() as Object3D & {
    jointType: string; jointValue: number[]; origin: Quaternion; axis: Vector3;
    setJointValue: (v: number) => boolean;
  };
  j.name = name;
  j.jointType = type;
  j.jointValue = [0];
  j.axis = new Vector3(0, 0, 1);
  j.origin = new Quaternion();
  j.setJointValue = (v: number) => {
    j.jointValue = [v];
    j.quaternion.copy(j.origin).multiply(new Quaternion().setFromAxisAngle(j.axis, v));
    return true;
  };
  return j;
}

function buildRobot() {
  const robot = new Object3D() as Object3D & { links: Record<string, Object3D>; joints: Record<string, ReturnType<typeof joint>> };
  robot.links = {};
  robot.joints = {};
  const link = (name: string, parent: Object3D) => {
    const l = new Object3D();
    l.name = name;
    parent.add(l);
    robot.links[name] = l;
    return l;
  };
  const addJoint = (name: string, parent: Object3D, at: Vector3, type = 'revolute') => {
    const j = joint(name, type);
    j.position.copy(at);
    parent.add(j);
    robot.joints[name] = j;
    return j;
  };
  const base = link('body_foot_3dprint', robot);
  const yaw = addJoint('yaw_body', base, new Vector3(0, 0, 0.03));
  const body = link('body_down_3dprint', yaw);
  const headCentre = new Vector3(0, 0, 0.03 + 0.12);
  const balls: Vector3[] = [];
  let head: Object3D | null = null;
  for (let i = 1; i <= 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const motorAt = new Vector3(Math.cos(angle) * 0.04, Math.sin(angle) * 0.04, 0.03);
    const motor = addJoint(`stewart_${i}`, body, motorAt);
    motor.axis.set(-Math.sin(angle), Math.cos(angle), 0);
    const horn = link(`horn_${i}`, motor);
    const ball = addJoint(`passive_${i}_x`, horn, new Vector3(0.02, 0, 0));
    ball.axis.set(1, 0, 0);
    const rod = link(`stewart_link_rod_${i}`, ball);
    // The rod points straight up from the ball at zero.
    const ballWorld = motorAt.clone().add(new Vector3(0.02, 0, 0)).add(new Vector3(0, 0, 0.03));
    balls.push(ballWorld);
    if (i < 6) {
      const end = link(`closing_${i}_1`, rod);
      end.position.set(0, 0, ROD);
    } else {
      const seven = addJoint('passive_7_x', rod, new Vector3(0, 0, ROD));
      head = link('xl_330', seven);
    }
  }
  robot.updateMatrixWorld(true);
  // Sockets on the head at the rod ends' zero positions; the head frame above it.
  const headBody = head!;
  for (let i = 1; i <= 5; i += 1) {
    const end = robot.links[`closing_${i}_1`].getWorldPosition(new Vector3());
    const socket = link(`closing_${i}_2`, headBody);
    socket.position.copy(headBody.worldToLocal(end));
  }
  const frame = link('head', headBody);
  frame.position.copy(headBody.worldToLocal(headCentre.clone()));
  frame.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.3);
  robot.updateMatrixWorld(true);
  return { robot, balls };
}

test('at rest every rod end already sits in its socket', () => {
  const { robot } = buildRobot();
  const rig = prepareRig(robot as never)!;
  assert.ok(rig);
  const frame = robot.links.head.matrixWorld.clone();
  const gap = applyState(rig, {
    headPose: frame, headJoints: [0, 0, 0, 0, 0, 0, 0], antennas: null, bodyYaw: null,
  });
  near(gap, 0, 1e-9);
});

test('the head goes exactly where the daemon says, and each rod points at its socket', () => {
  const { robot } = buildRobot();
  const rig = prepareRig(robot as never)!;
  const rest = robot.links.head.matrixWorld.clone();
  // Lift and tilt the head a little.
  const moved = new Matrix4().makeTranslation(0.004, -0.003, 0.006)
    .multiply(rest)
    .multiply(new Matrix4().makeRotationX(0.08));
  applyState(rig, {
    headPose: moved, headJoints: [0, 0.1, -0.1, 0.05, 0, 0.02, -0.03], antennas: null, bodyYaw: null,
  });
  const frameNow = robot.links.head.matrixWorld;
  for (let i = 0; i < 16; i += 1) near(frameNow.elements[i], moved.elements[i], 1e-9);
  // Each rod's end lies on the line from its ball through its socket.
  rig.rods.forEach((rod) => {
    const ball = rod.pivot.getWorldPosition(new Vector3());
    const tip = rod.tip.getWorldPosition(new Vector3()).sub(ball).normalize();
    const socket = rod.socket.getWorldPosition(new Vector3()).sub(ball).normalize();
    near(tip.dot(socket), 1, 1e-9);
  });
});

test('motors and antennas are set from the daemon numbers, in order', () => {
  const { robot } = buildRobot();
  // Give it antennas to set.
  ['left_antenna', 'right_antenna'].forEach((name) => {
    const j = joint(name);
    robot.add(j);
    robot.joints[name] = j;
  });
  const rig = prepareRig(robot as never)!;
  applyState(rig, {
    headPose: null, headJoints: [0.5, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], antennas: [0.7, -0.8], bodyYaw: 9,
  });
  assert.deepEqual(robot.joints.yaw_body.jointValue, [0.5]);
  for (let i = 1; i <= 6; i += 1) near(robot.joints[`stewart_${i}`].jointValue[0], i / 10);
  assert.deepEqual(robot.joints.left_antenna.jointValue, [0.7]);
  assert.deepEqual(robot.joints.right_antenna.jointValue, [-0.8]);
  // Without the motor list, body yaw comes from its own field.
  applyState(rig, {
    headPose: null, headJoints: null, antennas: null, bodyYaw: 0.25,
  });
  assert.deepEqual(robot.joints.yaw_body.jointValue, [0.25]);
});

test('a model that is not the Reachy is refused, not half-drawn', () => {
  const robot = new Object3D() as never as { links: Record<string, Object3D>; joints: Record<string, never> };
  Object.assign(robot, { links: {}, joints: {} });
  assert.equal(prepareRig(robot as never), null);
});
