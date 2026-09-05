/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type DesktopSession = {
  access_token: string;
  token_type: string;
  user: import("@/types").User;
};

interface Window {
  inkMindDesktop?: {
    readonly isDesktop: true;
    readonly apiBaseUrl: string;
    readonly platform: string;
    getSession: () => Promise<DesktopSession>;
  };
}
