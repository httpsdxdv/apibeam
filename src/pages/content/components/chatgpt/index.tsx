import { useCallback, useEffect } from 'react';
import { useMessageHandler } from '../../shared/useMessageHandler';

const APIBEAM_SOURCE = 'apibeam';
const APIBEAM_RESPONSE = 'apibeam-response';

const waitForComposer = async (timeoutMs = 20000): Promise<HTMLElement | null> => {
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
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  return null;
};

const waitForSendButton = async (timeoutMs = 8000): Promise<HTMLButtonElement | null> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const button =
      (document.querySelector('#composer-submit-button') as HTMLButtonElement | null) ||
      (document.querySelector('button[data-testid="send-button"]') as HTMLButtonElement | null);
    const label = button?.getAttribute('aria-label')?.toLowerCase() || '';
    if (button && !button.disabled && !label.includes('stop')) return button;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return null;
};

const isLikelyApiResponse = (value: any) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (Array.isArray(value.choices) ||
        value.error ||
        Array.isArray(value.output) ||
        value.object === 'response' ||
        typeof value.text === 'string'),
  );

export const ChatGPT = () => {
  const sendToChat = useCallback(
    async (
      content: { route: string; body?: object },
      prompt: string,
      _useTemporaryChat?: boolean,
    ) => {
      const contentArea = await waitForComposer();
      if (!contentArea) {
        chrome.runtime.sendMessage({
          type: 'question_error',
          error: {
            code: 'composer_not_found',
            message: 'ApiBeam waited for ChatGPT but the composer never became available.',
          },
        });
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
        chrome.runtime.sendMessage({
          type: 'question_error',
          error: {
            code: 'composer_input_failed',
            message: 'ApiBeam could not update the ChatGPT composer.',
          },
        });
        return;
      }

      const submitButton = await waitForSendButton();
      if (submitButton) {
        submitButton.click();
        return;
      }

      chrome.runtime.sendMessage({
        type: 'question_error',
        error: {
          code: 'composer_busy',
          message: 'ChatGPT composer appeared, but the Send button never became ready.',
        },
      });
    },
    [],
  );

  useMessageHandler(sendToChat);

  useEffect(() => {
    const newScript = document.createElement('script');
    newScript.src = chrome.runtime.getURL('loader.js');
    document.body.appendChild(newScript);

    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const envelope = event.data;
      let response: any = null;

      // New tagged envelope (supported by future loaders).
      if (
        envelope?.source === APIBEAM_SOURCE &&
        envelope?.type === APIBEAM_RESPONSE
      ) {
        response = envelope.data;
      } else {
        // Backward-compatible support for the current upstream loader, which
        // posts exactly { data: parsed }. Requiring a single-key envelope and
        // an API-looking payload prevents MetaMask's
        // { name: 'metamask-provider', data: ... } events from being forwarded.
        const keys =
          envelope && typeof envelope === 'object' ? Object.keys(envelope) : [];
        if (keys.length === 1 && keys[0] === 'data') {
          response = envelope.data;
        }
      }

      if (!isLikelyApiResponse(response)) return;

      chrome.runtime.sendMessage({
        type: 'question_answer',
        content: response,
      });
    };

    newScript.onload = () => {
      window.addEventListener('message', listener);
    };

    return () => {
      window.removeEventListener('message', listener);
      newScript.remove();
    };
  }, []);

  return <div />;
};
