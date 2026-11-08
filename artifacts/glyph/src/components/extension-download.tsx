import { useState } from 'react';
import { Download } from 'lucide-react';

export function ExtensionDownload() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}glyph-extension.zip`,
        { signal: AbortSignal.timeout(30_000) },
      );
      if (!response.ok) throw new Error('Download failed.');
      const blob = await response.blob();
      if (!blob.type.toLowerCase().includes('zip') || blob.size === 0) {
        throw new Error('The server did not return the extension ZIP.');
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'glyph-extension.zip';
      document.body.append(link);
      link.click();
      link.remove();
      // Allow the browser to consume the download before releasing its bytes.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError(
        'Could not download the extension. Try again, or open Glyph in a normal browser tab and download there.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => void download()}
        disabled={pending}
        data-testid="link-download-extension"
        className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        <Download className="size-4" />
        {pending ? 'Downloading…' : 'Download extension'}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-sm text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
