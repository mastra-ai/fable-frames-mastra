import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PRIVATE_KEY = process.env.SUPABASE_PRIVATE_KEY;

if (!SUPABASE_URL || !SUPABASE_PRIVATE_KEY) {
  throw new Error("Missing Supabase credentials");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PRIVATE_KEY);

export const uploadFile = async (
  bucketName: string,
  filePath: string,
  fileData: Buffer,
  options: { contentType: string }
) => {
  console.log("Uploading file to Supabase storage");
  const { error } = await supabase.storage
    .from(bucketName)
    .upload(filePath, fileData, options);

  if (error) {
    console.error("Error uploading file to Supabase storage", error);
    throw error;
  }

  console.log(`File uploaded to ${filePath}`);
};
