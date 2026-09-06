/** Minimal Tampermonkey / Greasemonkey API surface used by the entry point. */

interface GMXmlHttpRequestResponse {
  status: number;
  responseText: string;
}

interface GMXmlHttpRequestDetails {
  method: 'GET';
  url: string;
  timeout?: number;
  anonymous?: boolean;
  headers?: Record<string, string>;
  onload?: (response: GMXmlHttpRequestResponse) => void;
  onerror?: (response: GMXmlHttpRequestResponse) => void;
  ontimeout?: () => void;
}

declare function GM_xmlhttpRequest(details: GMXmlHttpRequestDetails): void;
declare function GM_getValue(key: string, defaultValue?: unknown): unknown;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_deleteValue(key: string): void;
