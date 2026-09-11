import { useCallback, useEffect, useRef } from 'react';
import { useMessageHandler } from '../../shared/useMessageHandler';

const APIBEAM_SOURCE = 'apibeam';
const APIBEAM_RESPONSE = 'apibeam-response';
const LOCAL_API_BASE = 'http://127.0.0.1:3000/';
const LOCAL_ROOM_ID = 'local-cline';
const WORKER_SESSION_KEY = '__apibeam_worker';

const sleep = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const isDedicatedWorkerTab = () => {
  const requested =
    new URLSearchParams(window.location.search).get('apibeam') === '1';
  if (requested) window.sessionStorage.setItem(WORKER_SESSION_KEY, '1');
  return requested || window.sessionStorage.getItem(WORKER_SESSION_KEY) === '1';
};

const waitForComposer = async (
  timeoutMs = 20000,
): Promise<HTMLElement | null> => {
  const deadline = Date.now() + timeoutMs;
  const selectors = [
    '#prompt-textarea',
    'div.ProseMirror[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[placeholder]',
  ];
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (element) return element;
    }
    await sleep(150);
  }
  return null;
};

const waitForSendButton = async (
  timeoutMs = 8000,
): Promise<HTMLButtonElement | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const button =
      (document.querySelector('#composer-submit-button') as HTMLButtonElement | null) ||
      (document.querySelector('button[data-testid="send-button"]') as HTMLButtonElement | null);
    const label = button?.getAttribute('aria-label')?.toLowerCase() || '';
    if (button && !button.disabled && !label.includes('stop')) return button;
    await sleep(100);
  }
  return null;
};

const isLikelyApiResponse = (value: any) =>
  Boolean(
    value && typeof value === 'object' &&
    (Array.isArray(value.choices) || value.error || Array.isArray(value.output) ||
      value.object === 'response' || typeof value.text === 'string'),
  );

export const ChatGPT = () => {
  const activeHttpRequestId = useRef<string | null>(null);
  const workerMode = isDedicatedWorkerTab();

  const postHttpResponse = useCallback(async (requestId: string, message: any) => {
    const response = await fetch(
      `${LOCAL_API_BASE}connect/${LOCAL_ROOM_ID}/response`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, message }),
      },
    );
    if (!response.ok) {
      throw new Error(`ApiBeam response POST failed (${response.status})`);
    }
  }, []);

  const reportQuestionError = useCallback(
    async (code: string, message: string) => {
      const requestId = activeHttpRequestId.current;
      const payload = {
        error: { code, message, type: 'apibeam_browser_error' },
      };

      if (workerMode && requestId) {
        try {
          await postHttpResponse(requestId, payload);
        } finally {
          activeHttpRequestId.current = null;
        }
        return;
      }

      chrome.runtime.sendMessage({
        type: 'question_error',
        error: payload.error,
      });
    },
    [postHttpResponse, workerMode],
  );

  const sendToChat = useCallback(
    async (
      content: { route: string; body?: object },
      prompt: string,
      _useTemporaryChat?: boolean,
    ) => {
      const contentArea = await waitForComposer();
      if (!contentArea) {
        await reportQuestionError(
          'composer_not_found',
          'ApiBeam waited for ChatGPT but the composer never became available.',
        );
        return;
      }

      const text = `${prompt ? `${prompt}\n` : ''}Route: ${content.route}\nPayload: ${JSON.stringify(content.body)}`;
      contentArea.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(contentArea);
      selection?.removeAllRanges();
      selection?.addRange(range);

      const inserted = document.execCommand('insertText', false, text);
      if (!inserted) {
        await reportQuestionError(
          'composer_input_failed',
          'ApiBeam could not update the ChatGPT composer.',
        );
        return;
      }

      const submitButton = await waitForSendButton();
      if (submitButton) {
        submitButton.click();
        return;
      }

      await reportQuestionError(
        'composer_busy',
        'ChatGPT composer appeared, but the Send button never became ready.',
      );
    },
    [reportQuestionError],
  );

  useMessageHandler(sendToChat);

  useEffect(() => {
    if (!workerMode) return;

    let stopped = false;
    void (async () => {
      while (!stopped) {
        try {
          const response = await fetch(
            `${LOCAL_API_BASE}connect/${LOCAL_ROOM_ID}/next`,
            { cache: 'no-store' },
          );
          if (!response.ok) {
            throw new Error(`ApiBeam poll failed (${response.status})`);
          }

          const data = await response.json();
          const request = data?.request;
          if (request?.requestId && !activeHttpRequestId.current) {
            activeHttpRequestId.current = request.requestId;
            await sendToChat(request, '', false);
          }
        } catch (error) {
          console.warn('[ApiBeam] HTTP worker poll failed', error);
        }

        await sleep(activeHttpRequestId.current ? 400 : 700);
      }
    })();

    return () => {
      stopped = true;
    };
  }, [sendToChat, workerMode]);

  useEffect(() => {
    const newScript = document.createElement('script');
    newScript.src = chrome.runtime.getURL('loader.js');
    document.body.appendChild(newScript);

    const listener = async (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;

      const envelope = event.data;
      let response: any = null;
      if (
        envelope?.source === APIBEAM_SOURCE &&
        envelope?.type === APIBEAM_RESPONSE
      ) {
        response = envelope.data;
      } else {
        const keys =
          envelope && typeof envelope === 'object' ? Object.keys(envelope) : [];
        if (keys.length === 1 && keys[0] === 'data') {
          response = envelope.data;
        }
      }

      if (!isLikelyApiResponse(response)) return;

      const requestId = activeHttpRequestId.current;
      if (workerMode && requestId) {
        try {
          await postHttpResponse(requestId, response);
        } catch (error) {
          console.error('[ApiBeam] HTTP response delivery failed', error);
          return;
        }
        activeHttpRequestId.current = null;
        return;
      }

      chrome.runtime.sendMessage({
        type: 'question_answer',
        content: response,
      });
    };

    newScript.onload = () => window.addEventListener('message', listener);

    return () => {
      window.removeEventListener('message', listener);
      newScript.remove();
    };
  }, [postHttpResponse, workerMode]);

  return <div />;
};
