interface PywebviewDownloadResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

interface PywebviewApi {
  download_file: (urlPath: string, filename: string) => Promise<PywebviewDownloadResult>;
}

interface Window {
  pywebview?: { api: PywebviewApi };
}
