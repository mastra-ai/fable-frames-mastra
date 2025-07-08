import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { experimental_generateImage as generateImage } from "ai";
import { openai } from "@ai-sdk/openai";
import { uploadFile } from "../../utils/storage";

// Define the Enhance Character step
const enhanceCharacterStep = createStep({
  id: "enhanceCharacter",
  inputSchema: z.object({
    characterDescription: z.string(),
    style: z.string(),
  }),
  outputSchema: z.object({
    characterPrompts: z.array(z.string()).length(3),
    style: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    // Get the basic character description from the trigger data
    const basicCharacterDescription = inputData.characterDescription;
    const characterWriter = mastra.getAgent("characterWriter");

    // Use the characterWriter agent to enhance the character description
    const response = await characterWriter.generate(
      `Transform this basic character description into three detailed character options. Limit each description to 2 sentences: ${basicCharacterDescription}`,
      {
        output: z.array(z.string()).length(3),
      }
    );
    console.log("Enhanced character descriptions:", response.object);

    return {
      characterPrompts: response.object,
      style: inputData.style,
    };
  },
});

// Define the Generate Character step - this step generates images
const generateCharacterStep = createStep({
  id: "generateCharacter",
  inputSchema: z.object({
    characterPrompts: z.array(z.string()),
    style: z.string(),
  }),
  outputSchema: z.object({
    characterPrompts: z.array(z.string()),
    style: z.string(),
    characterImages: z.array(z.string()),
  }),
  execute: async ({ inputData, runId }) => {
    const style = inputData.style;
    const characterPrompts = inputData?.characterPrompts || [];

    const bucketName = "characters";
    const storageUrl = process.env.SUPABASE_STORAGE_URL;

    // Generate images for each character description in parallel
    const characterImagesPromises = characterPrompts.map(
      async (characterPrompt, index) => {
        // Prepare image generation prompt
        const imagePrompt = `Create a children's book illustration of this character: ${characterPrompt}. 
      The illustration should be vibrant, expressive, and suitable for a children's story. 
      Show the full character with a simple background that highlights their key features.
      ${style}`;

        try {
          // Generate images
          const { images } = await generateImage({
            model: openai.image("gpt-image-1"),
            prompt: imagePrompt,
            n: 1, // Generate one image per description
            size: "1024x1024",
            // providerOptions: {
            //   openai: { quality: "medium" },
            // },
          });

          console.log(
            `Generated images count for character ${index + 1}:`,
            images.length
          );

          // Process the generated image
          const image = images[0];
          const filePath = `${runId}/character${index + 1}.png`;
          const fileData = Buffer.from(image.base64, "base64");

          await uploadFile(bucketName, filePath, fileData, {
            contentType: "image/png",
          });
          console.log(
            `Finished uploading image for character ${index + 1} to Supabase storage`
          );

          return `${storageUrl}/${bucketName}/${filePath}`;
        } catch (error) {
          console.error(
            `Failed to generate image for character ${index + 1}:`,
            error
          );
          throw new Error(
            `Failed to generate image for character ${index + 1}`
          );
        }
      }
    );

    // Wait for all image generation promises to resolve
    const characterImages = await Promise.all(characterImagesPromises);

    return {
      style,
      characterImages,
      characterPrompts,
    };
  },
});

// Create the master workflow
export const generateCharactersWorkflow = createWorkflow({
  id: "generateCharacters",
  description: "Generate characters for a children's book",
  inputSchema: z.object({
    characterDescription: z.string(),
    style: z.string(),
  }),
  outputSchema: z.object({
    characterPrompts: z.array(z.string()),
    style: z.string(),
    characterImages: z.array(z.string()),
  }),
})
  .then(enhanceCharacterStep)
  .then(generateCharacterStep)
  .commit();
