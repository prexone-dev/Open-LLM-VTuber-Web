/* eslint-disable global-require */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-use-before-define */
import { Subject } from 'rxjs';
import { ModelInfo } from '@/context/live2d-config-context';
import { HistoryInfo } from '@/context/websocket-context';
import { ConfigFile } from '@/context/character-config-context';
import { toaster } from '@/components/ui/toaster';
import {
  ConnectionKeeper, serverReady, SocketLike, SocketState,
} from '@/services/reconnect';

export interface DisplayText {
  text: string;
  name: string;
  avatar: string;
}

interface BackgroundFile {
  name: string;
  url: string;
}

export interface AudioPayload {
  type: 'audio';
  audio?: string;
  volumes?: number[];
  slice_length?: number;
  display_text?: DisplayText;
  actions?: Actions;
}

export interface Message {
  id: string;
  content: string;
  role: "ai" | "human";
  timestamp: string;
  name?: string;
  avatar?: string;

  // Fields for different message types (make optional)
  type?: 'text' | 'tool_call_status'; // Add possible types, default to 'text' if omitted
  tool_id?: string; // Specific to tool calls
  tool_name?: string; // Specific to tool calls
  status?: 'running' | 'completed' | 'error'; // Specific to tool calls
}

export interface Actions {
  expressions?: string[] | number [];
  pictures?: string[];
  sounds?: string[];
}

export interface MessageEvent {
  /** Voice ID's verdict on a stretch of speech (Virgil). */
  allowed?: boolean;
  score?: number | null;
  why?: string;
  tool_id: any;
  tool_name: any;
  name: any;
  status: any;
  content: string;
  timestamp: string;
  type: string;
  audio?: string;
  volumes?: number[];
  slice_length?: number;
  files?: BackgroundFile[];
  actions?: Actions;
  text?: string;
  model_info?: ModelInfo;
  conf_name?: string;
  conf_uid?: string;
  uids?: string[];
  messages?: Message[];
  history_uid?: string;
  success?: boolean;
  histories?: HistoryInfo[];
  configs?: ConfigFile[];
  message?: string;
  members?: string[];
  is_owner?: boolean;
  client_uid?: string;
  forwarded?: boolean;
  display_text?: DisplayText;
  live2d_model?: string;
  browser_view?: {
    debuggerFullscreenUrl: string;
    debuggerUrl: string;
    pages: {
      id: string;
      url: string;
      faviconUrl: string;
      title: string;
      debuggerUrl: string;
      debuggerFullscreenUrl: string;
    }[];
    wsUrl: string;
    sessionId?: string;
  };
}

// Get translation function for error messages
const getTranslation = () => {
  try {
    const i18next = require('i18next').default;
    return i18next.t.bind(i18next);
  } catch (e) {
    // Fallback if i18next is not available
    return (key: string) => key;
  }
};

type WsState = SocketState;

class WebSocketService {
  private static instance: WebSocketService;

  private messageSubject = new Subject<MessageEvent>();

  private stateSubject = new Subject<WsState>();

  /**
   * The page keeps its own connection (Virgil, OLV7-31): it waits for the
   * server to be ready, and tries again on its own whenever the server is not
   * there or goes away - nobody has to click "reconnect".
   */
  private keeper = new ConnectionKeeper({
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    ready: (url) => serverReady(url),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onState: (state) => this.stateSubject.next(state),
    onOpen: () => this.initializeConnection(),
    onData: (data) => this.receive(data),
  });

  static getInstance() {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  private initializeConnection() {
    this.sendMessage({
      type: 'fetch-backgrounds',
    });
    this.sendMessage({
      type: 'fetch-configs',
    });
    this.sendMessage({
      type: 'fetch-history-list',
    });
    this.sendMessage({
      type: 'create-new-history',
    });
  }

  private receive(data: unknown) {
    try {
      const message = JSON.parse(data as string);
      this.messageSubject.next(message);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
      toaster.create({
        title: `${getTranslation()('error.failedParseWebSocket')}: ${error}`,
        type: "error",
        duration: 2000,
      });
    }
  }

  connect(url: string) {
    this.keeper.connect(url);
  }

  /** Leave this session and try again shortly: it came up without what the page needs. */
  reconnectSoon(reason: string) {
    console.warn(`Reconnecting: ${reason}`);
    this.keeper.reconnectSoon();
  }

  sendMessage(message: object) {
    const socket = this.keeper.openSocket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not open. Unable to send message:', message);
      toaster.create({
        title: getTranslation()('error.websocketNotOpen'),
        type: 'error',
        duration: 2000,
      });
    }
  }

  onMessage(callback: (message: MessageEvent) => void) {
    return this.messageSubject.subscribe(callback);
  }

  onStateChange(callback: (state: WsState) => void) {
    // A subscriber that arrives after the first try started still learns
    // where things stand, rather than showing "closed" until something changes.
    callback(this.keeper.current);
    return this.stateSubject.subscribe(callback);
  }

  /** Close on purpose: nothing retries until connect() is called again. */
  disconnect() {
    this.keeper.disconnect();
  }

  getCurrentState() {
    return this.keeper.current;
  }
}

export const wsService = WebSocketService.getInstance();
