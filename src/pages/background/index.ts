import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

// This fork is optimized for local Docker self-hosting.
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000/';
export const DEFAULT_ROOM_ID = 'local-cline';
const chatgptBaseUrl = 'https://chatgpt.com/?apibeam=1';
const claudeBaseUrl = 'https://claude.ai/new';
const zaiBaseUrl = 'https://chat.z.ai';

const normalizeApiBaseUrl = (value: string) => {
  const trimmed = (value || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '');
  return `${trimmed}/`;
};

const buildProviderUrl = (
  provider: Provider,
  useTemporaryChat: boolean,
): string => {
  if (provider === 'claude') {
    return useTemporaryChat ? `${claudeBaseUrl}?incognito=` : claudeBaseUrl;
  }

  const url = provider === 'zai' ? zaiBaseUrl : chatgptBaseUrl;
  return useTemporaryChat ? `${url}?temporary-chat=true` : url;
};

export type Provider = 'chatgpt' | 'claude' | 'zai';

export type SettingsSchema = {
  language: string;
  method: string;
  roomId: string;
  useTemporaryChat?: boolean;
};

type RelayRequest = {
  requestId: string;
  route: string;
  body?: any;
  [key: string]: any;
};

type AgentMessage = {
  type:
    | 'question_answer'
    | 'question_error'
    | 'set_settings'
    | 'get_settings'
    | 'get_connect_url'
    | 'get_api_base_url'
    | 'set_api_base_url'
    | 'set_provider'
    | 'get_provider'
    | 'connect'
    | 'disconnect'
    | 'get_connection_status'
    | 'http_bridge_poll'
    | 'http_bridge_respond';
  content?: any;
  requestId?: string;
  error?: any;
};

let socketConnectionStatus: {
  status: 'pending' | 'connected' | 'failed' | 'disconnected';
  errorMessage?: string;
} = {
  status: 'disconnected',
  errorMessage: undefined,
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/pages/settings/index.html'),
    });
  }
});

const getRoomId = () =>
  new Promise<string>((resolve) => {
    chrome.storage.local.get('roomId', (settings) => {
      if (settings?.roomId !== DEFAULT_ROOM_ID) {
        chrome.storage.local.set({ roomId: DEFAULT_ROOM_ID });
      }
      resolve(DEFAULT_ROOM_ID);
    });
  });

const getApiBaseUrl = () =>
  new Promise<string>((resolve) => {
    chrome.storage.local.get(['apiBaseUrl'], (result) => {
      const localBase = normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
      const storedBase = normalizeApiBaseUrl(result.apiBaseUrl || DEFAULT_API_BASE_URL);
      if (storedBase !== localBase) {
        chrome.storage.local.set({ apiBaseUrl: localBase });
      }
      resolve(localBase);
    });
  });

const getProvider = () =>
  new Promise<Provider>((resolve) => {
    chrome.storage.local.get(['provider'], (result) => {
      resolve((result.provider as Provider) || 'chatgpt');
    });
  });

const getUseTemporaryChat = () =>
  new Promise<boolean>((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      const settings = result.settings as SettingsSchema | undefined;
      resolve(settings?.useTemporaryChat || false);
    });
  });

const getConnectUrl = async () => {
  const roomId = await getRoomId();
  const base = await getApiBaseUrl();
  return `${base}app/${roomId}`;
};

void getRoomId();

let tabId: number | undefined;
let socket: Socket | undefined;
const requestQueue: RelayRequest[] = [];
let activeRequest: RelayRequest | undefined;
let processingQueue = false;
let httpBridgeRunning = false;
let httpBridgeConnected = false;
let httpBridgeGeneration = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const broadcastConnectionStatus = () => {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.id) return;
      chrome.tabs.sendMessage(
        tab.id,
        {
          type: 'get_connection_status',
          content: socketConnectionStatus,
        },
        () => chrome.runtime.lastError,
      );
    });
  });
};

const setConnectionStatus = (
  status: typeof socketConnectionStatus.status,
  errorMessage = '',
) => {
  socketConnectionStatus = { status, errorMessage };
  broadcastConnectionStatus();
};

const isProviderTab = (url: string | undefined, provider: Provider) => {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    if (provider === 'chatgpt') return hostname === 'chatgpt.com';
    if (provider === 'claude') return hostname === 'claude.ai';
    return hostname === 'chat.z.ai';
  } catch {
    return false;
  }
};

const createProviderTab = (providerUrl: string) =>
  new Promise<number>((resolve, reject) => {
    chrome.tabs.create({ url: providerUrl, active: true }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!tab.id) return reject(new Error('Browser did not return a tab id'));
      tabId = tab.id;
      resolve(tab.id);
    });
  });

const ensureProviderTab = async (
  provider: Provider,
  providerUrl: string,
): Promise<number> => {
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (isProviderTab(tab.url, provider)) return tabId;
    } catch {
      // Tab was closed; create a replacement below.
    }
  }

  tabId = undefined;
  return createProviderTab(providerUrl);
};

const sendMessageToTabWithRetry = (
  id: number,
  payload: any,
  retries = 6,
  delay = 1000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(id, payload, () => {
      const error = chrome.runtime.lastError;
      if (!error) return resolve();

      if (retries <= 0) return reject(new Error(error.message));
      setTimeout(() => {
        sendMessageToTabWithRetry(id, payload, retries - 1, delay).then(
          resolve,
          reject,
        );
      }, delay);
    });
  });

const sendClientResponse = async (requestId: string, message: any) => {
  const roomId = await getRoomId();
  if (socket?.connected) {
    socket.emit('clientResponse', { roomId, requestId, message });
    return;
  }

  const base = await getApiBaseUrl();
  const response = await fetch(`${base}connect/${roomId}/response`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, message }),
  });
  if (!response.ok) throw new Error(`HTTP bridge response failed (${response.status})`);
};

const emitActiveFailure = async (message: string, code = 'browser_delivery_error') => {
  if (!activeRequest) return;
  const requestId = activeRequest.requestId;
  await sendClientResponse(requestId, {
    error: { message, type: 'apibeam_browser_error', code },
  });
  activeRequest = undefined;
};

const processNextRequest = async () => {
  if (processingQueue || activeRequest || requestQueue.length === 0) return;
  if (!socket?.connected && !httpBridgeConnected) return;

  processingQueue = true;
  activeRequest = requestQueue.shift();

  try {
    if (!activeRequest) return;

    const provider = await getProvider();
    const useTemporaryChat = await getUseTemporaryChat();
    const providerUrl = buildProviderUrl(provider, useTemporaryChat);

    let id = await ensureProviderTab(provider, providerUrl);
    const payload = {
      type: 'ask_question',
      content: activeRequest,
      useTemporaryChat,
    };

    try {
      await sendMessageToTabWithRetry(id, payload);
    } catch {
      // A stale/reloaded tab can lose its content script. Recreate the tab once
      // and retry instead of dropping the API request.
      tabId = undefined;
      id = await createProviderTab(providerUrl);
      await sendMessageToTabWithRetry(id, payload);
    }
  } catch (error) {
    await emitActiveFailure(
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    processingQueue = false;
    if (!activeRequest) void processNextRequest();
  }
};

const resetActiveBrowserRequest = async (requestId: string) => {
  // Remove a queued request that timed out before it reached the browser.
  const queuedIndex = requestQueue.findIndex(
    (request) => request.requestId === requestId,
  );
  if (queuedIndex >= 0) {
    requestQueue.splice(queuedIndex, 1);
    return;
  }

  if (activeRequest?.requestId !== requestId) return;

  // Reloading the dedicated provider tab aborts a late ChatGPT generation so
  // it cannot be mistaken for the next queued request.
  if (tabId) {
    try {
      await chrome.tabs.reload(tabId);
    } catch {
      tabId = undefined;
    }
  }

  activeRequest = undefined;
  setTimeout(() => void processNextRequest(), 2500);
};

const startHttpBridge = () => {
  if (httpBridgeRunning) return;
  httpBridgeRunning = true;
  const generation = ++httpBridgeGeneration;

  void (async () => {
    while (httpBridgeRunning && generation === httpBridgeGeneration) {
      let delay = 750;
      try {
        const roomId = await getRoomId();
        const base = await getApiBaseUrl();
        const response = await fetch(`${base}connect/${roomId}/next`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`HTTP bridge poll failed (${response.status})`);

        const data = await response.json();
        httpBridgeConnected = true;
        if (!socket?.connected && socketConnectionStatus.status !== 'connected') {
          setConnectionStatus('connected');
        }

        const request = data?.request as RelayRequest | null;
        if (
          request?.requestId &&
          activeRequest?.requestId !== request.requestId &&
          !requestQueue.some((item) => item.requestId === request.requestId)
        ) {
          requestQueue.push(request);
          void processNextRequest();
          delay = 50;
        }
      } catch (error) {
        httpBridgeConnected = false;
        if (!socket?.connected) {
          setConnectionStatus(
            'disconnected',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      await sleep(delay);
    }
  })();
};

const stopHttpBridge = () => {
  httpBridgeRunning = false;
  httpBridgeConnected = false;
  httpBridgeGeneration += 1;
};

async function connectWS() {
  // Firefox Manifest V3 background pages are non-persistent. The dedicated
  // ChatGPT content tab owns the local HTTP poller so active requests survive
  // background eviction. Socket.IO remains available for browsers where it works.
  const baseUrl = await getApiBaseUrl();

  if (socket?.connected) return;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = undefined;
  }

  setConnectionStatus('pending');

  socket = io(baseUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', async () => {
    const roomId = await getRoomId();
    const base = await getApiBaseUrl();

    setConnectionStatus('connected');
    try {
      const response = await fetch(
        `${base}connect/${roomId}?socketId=${encodeURIComponent(socket?.id || '')}`,
      );
      if (!response.ok) throw new Error(`Room join failed (${response.status})`);
      void processNextRequest();
    } catch (error) {
      setConnectionStatus(
        'failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  socket.on('disconnect', (reason) => {
    if (!httpBridgeConnected) setConnectionStatus('disconnected', reason);
  });

  socket.on('connect_error', (error) => {
    if (!httpBridgeConnected) setConnectionStatus('disconnected', error.message);
  });

  socket.on('serverMessage', (message: RelayRequest) => {
    if (!message?.requestId) {
      console.warn('[ApiBeam] Ignoring serverMessage without requestId', message);
      return;
    }
    requestQueue.push(message);
    void processNextRequest();
  });

  socket.on('cancelRequest', ({ requestId }: { requestId: string }) => {
    void resetActiveBrowserRequest(requestId);
  });
}

const disconnectWS = () => {
  stopHttpBridge();
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = undefined;
  setConnectionStatus('disconnected');
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'apibeam-keepalive') return;
  port.onDisconnect.addListener(() => {
    // The provider tab owns the port. Firefox may suspend this event page
    // after the tab closes, which is expected.
  });
});

chrome.runtime.onMessage.addListener(
  (msg: AgentMessage, sender, sendResponse) => {
    void (async () => {
      const senderTabId = sender.tab?.id;

      if (msg.type === 'http_bridge_poll') {
        try {
          const roomId = await getRoomId();
          const base = await getApiBaseUrl();
          const response = await fetch(`${base}connect/${roomId}/next`, { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP bridge poll failed (${response.status})`);
          httpBridgeConnected = true;
          if (socketConnectionStatus.status !== 'connected') setConnectionStatus('connected');
          sendResponse({ ok: true, data: await response.json() });
        } catch (error) {
          httpBridgeConnected = false;
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (msg.type === 'http_bridge_respond') {
        try {
          const roomId = await getRoomId();
          const base = await getApiBaseUrl();
          const response = await fetch(`${base}connect/${roomId}/response`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(msg.content),
          });
          if (!response.ok) throw new Error(`HTTP bridge response failed (${response.status})`);
          let data: any = {};
          try { data = await response.json(); } catch { data = {}; }
          sendResponse({ ok: true, data });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      if (msg.type === 'question_answer' || msg.type === 'question_error') {
        if (!activeRequest) return;

        const requestId = activeRequest.requestId;
        const responseMessage =
          msg.type === 'question_answer'
            ? msg.content
            : {
                error: {
                  message:
                    msg.error?.message ||
                    msg.content?.message ||
                    'The browser could not submit the ApiBeam request.',
                  type: 'apibeam_browser_error',
                  code: msg.error?.code || 'browser_submission_error',
                },
              };

        await sendClientResponse(requestId, responseMessage);

        activeRequest = undefined;
        void processNextRequest();
        return;
      }

      if (msg.type === 'set_settings') {
        await chrome.storage.local.set({ settings: msg.content });
        return;
      }

      if (msg.type === 'get_settings') {
        if (senderTabId) {
          const result = await chrome.storage.local.get('settings');
          chrome.tabs.sendMessage(senderTabId, {
            type: 'set_settings',
            content: result.settings,
          });
        }
        return;
      }

      if (msg.type === 'get_connect_url' || msg.type === 'get_api_base_url') {
        if (senderTabId) {
          const base = await getApiBaseUrl();
          const payload =
            msg.type === 'get_connect_url' ? await getConnectUrl() : base;
          chrome.tabs.sendMessage(senderTabId, {
            type:
              msg.type === 'get_connect_url'
                ? 'set_connect_url'
                : 'set_api_base_url',
            content: payload,
          });
        }
        return;
      }

      if (msg.type === 'set_api_base_url') {
        const newUrl = normalizeApiBaseUrl(String(msg.content || ''));
        await chrome.storage.local.set({ apiBaseUrl: newUrl });
        disconnectWS();
        await connectWS();

        if (senderTabId) {
          chrome.tabs.sendMessage(senderTabId, {
            type: 'set_connect_url',
            content: await getConnectUrl(),
          });
        }
        return;
      }

      if (msg.type === 'set_provider') {
        const provider = msg.content as Provider;
        await chrome.storage.local.set({ provider });
        if (senderTabId) {
          chrome.tabs.sendMessage(senderTabId, {
            type: 'set_provider',
            content: provider,
          });
        }
        return;
      }

      if (msg.type === 'get_provider') {
        if (senderTabId) {
          chrome.tabs.sendMessage(senderTabId, {
            type: 'set_provider',
            content: await getProvider(),
          });
        }
        return;
      }

      if (msg.type === 'connect') {
        await connectWS();
        return;
      }

      if (msg.type === 'disconnect') {
        disconnectWS();
        return;
      }

      if (msg.type === 'get_connection_status') {
        sendResponse({
          type: 'get_connection_status',
          content: socketConnectionStatus,
        });
      }
    })();

    return true;
  },
);

// The persistent provider tab owns local relay polling. Socket.IO is available
// only when explicitly requested, avoiding Firefox MV3 worker reconnect races.
