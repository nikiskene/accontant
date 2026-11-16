import { supabase } from '../lib/supabase';

export async function loadDocumentLogo(path?: string | null): Promise<string | undefined> {
  if (!path) return undefined;
  const { data, error } = await supabase.storage.from('finance-documents').createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error('Could not load the saved logo.');
  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error('Could not load the saved logo.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the saved logo.'));
    reader.readAsDataURL(blob);
  });
}
