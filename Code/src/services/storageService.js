import { supabase } from '../supabaseClient';

/**
 * Generates a temporary signed URL for a private file.
 * @param {string} filePath - The path inside the bucket (e.g., 'CTCAE.pdf')
 * @param {string} bucket - The bucket name (default: 'pdfs')
 * @returns {Promise<string|null>} - The signed URL or null if error
 */
export const getSignedUrl = async (filePath, bucket = 'pdfs') => {
  try {
    // URL is valid for 60 seconds (enough time to download or open)
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .createSignedUrl(filePath, 60);

    if (error) {
      console.error("Error signing URL:", error);
      return null;
    }

    return data.signedUrl;
  } catch (e) {
    console.error("Storage Service Error:", e);
    return null;
  }
};