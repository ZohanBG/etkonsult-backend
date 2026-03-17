declare module 'pdf-poppler' {
  interface ConvertOptions {
    format?: 'jpeg' | 'png' | 'tiff';
    out_dir?: string;
    out_prefix?: string;
    page?: number | null;
    scale?: number;
    density?: number;
  }

  export function convert(pdfPath: string, options: ConvertOptions): Promise<void>;
  export function info(pdfPath: string): Promise<{
    pages: number;
    title?: string;
    author?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modificationDate?: string;
  }>;
}
