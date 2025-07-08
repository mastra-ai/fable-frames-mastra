import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { uploadFile } from "../../utils/storage";
import OpenAI, { toFile } from "openai";
import fetch from "node-fetch";

const client = new OpenAI();

// Step 1: Generate Story Pages
const generateStoryPagesStep = createStep({
  id: "generateStoryPages",
  inputSchema: z.object({
    characterPrompt: z.string(),
    characterImageUrl: z.string(),
    characterName: z.string(),
    style: z.string(),
    storyTheme: z.string(),
  }),
  outputSchema: z.object({
    characterPrompt: z.string(),
    characterImageUrl: z.string(),
    characterName: z.string(),
    style: z.string(),
    storyTheme: z.string(),
    pages: z.array(z.string()),
    title: z.string(),
    setting: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const {
      characterName,
      storyTheme,
      characterPrompt,
      characterImageUrl,
      style,
    } = inputData;
    const storyGenerator = mastra.getAgent("storyGenerator");

    // Create a prompt for the story generator
    let prompt = `Create a children's story with the following character: ${characterName}. 
      A description of the character is: ${characterPrompt}.
      The theme of the story should be: ${storyTheme}.`;

    // Define the output schema for structured output
    const outputSchema = z.object({
      title: z.string().describe("The title of the story"),
      pages: z
        .array(z.string())
        .describe(
          "An array of pages, where each page is a string containing that page's text"
        ),
      setting: z
        .string()
        .describe(
          "A vivid description of the story's overall setting, environment, time period, and atmosphere"
        ),
    });

    // Use the storyGenerator agent to create the story with structured output
    const response = await storyGenerator.generate(prompt, {
      output: outputSchema,
    });

    // Return the structured output directly
    return {
      characterPrompt,
      characterImageUrl,
      characterName,
      style,
      storyTheme,
      title: response.object.title,
      pages: response.object.pages,
      setting: response.object.setting,
    };
  },
});

// Step 2: Generate Page Images
const generatePageImagesStep = createStep({
  id: "generatePageImages",
  inputSchema: z.object({
    characterPrompt: z.string(),
    characterImageUrl: z.string(),
    characterName: z.string(),
    style: z.string(),
    storyTheme: z.string(),
    pages: z.array(z.string()),
    title: z.string(),
    setting: z.string(),
  }),
  outputSchema: z.object({
    characterPrompt: z.string(),
    characterImageUrl: z.string(),
    characterName: z.string(),
    style: z.string(),
    storyTheme: z.string(),
    pages: z.array(z.string()),
    title: z.string(),
    setting: z.string(),
    imageDescriptions: z.array(z.string()),
    imageUrls: z.array(z.string()),
  }),
  execute: async ({ inputData, runId, mastra }) => {
    // Get story data from previous step

    const {
      characterPrompt,
      characterImageUrl,
      characterName,
      style,
      storyTheme,
      pages,
      title,
      setting,
    } = inputData;
    const imageWriter = mastra.getAgent("imageWriter");

    if (!pages || pages.length === 0) {
      return {
        characterPrompt,
        characterImageUrl,
        characterName,
        style,
        storyTheme,
        pages,
        title,
        setting,
        imageDescriptions: [],
        imageUrls: [],
      };
    }

    const bucketName = "stories";
    const storageUrl = process.env.SUPABASE_STORAGE_URL;

    // Process each page in parallel
    const imageGenerationPromises = pages.map(async (pageText, index) => {
      // 1. Generate image description using imageWriter agent
      const outputSchema = z.object({
        imageDescription: z
          .string()
          .describe(
            "A vivid, detailed description of an image that represents the page content"
          ),
      });

      // Create a prompt for the image writer
      const prompt = `
Page ${index + 1} Text: "${pageText}"

Character Description: "${characterPrompt}"

Character Name: "${characterName}"

Story Setting: "${setting}"

Based on this page text, character description, and the overall story setting, create a vivid, detailed image description that captures the essence of this moment in the story. The description should help generate an illustration for a children's book.

Ensure the image description incorporates elements from the story setting and maintains visual consistency throughout the story. Consider lighting, colors, mood, and perspective that best represent this scene.`;

      // Use the imageWriter agent to create the image description
      const response = await imageWriter.generate(prompt, {
        output: outputSchema,
      });

      const imageDescription = response.object.imageDescription;

      // 2. Generate actual image using DALL-E based on the description
      try {
        // const { image } = await generateImage({
        //   model: openai.image("gpt-image-1"),
        //   prompt: `${imageDescription} ${style}`,
        //   size: "1024x1024",
        //   providerOptions: {
        //     openai: { style: "vivid", quality: "hd" },
        //   },
        // });

        const response = await fetch(characterImageUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const imageFile = await toFile(buffer, null, { type: "image/png" });

        const rsp = await client.images.edit({
          model: "gpt-image-1",
          image: imageFile,
          size: "1024x1024",
          prompt: `Create a children's storybook illustration for the character shown in the image. The image description is: ${imageDescription}. The style of the illustration should be: ${style}.`,
        });

        // Use runId to determine the file name
        const filePath = `${runId}/page${index + 1}.png`;
        const image_base64 = rsp.data?.[0]?.b64_json;
        if (!image_base64) {
          throw new Error("Failed to get base64 image data from response");
        }
        const fileData = Buffer.from(image_base64, "base64");

        // Upload the file to the stories bucket
        await uploadFile(bucketName, filePath, fileData, {
          contentType: "image/png",
        });
        console.log(
          `Finished uploading image for page ${index + 1} to Supabase storage`
        );

        return {
          imageDescription,
          imageUrl: `${storageUrl}/${bucketName}/${filePath}`,
        };
      } catch (error) {
        console.error(`Failed to generate image for page ${index + 1}:`, error);
        // If image generation fails, use a placeholder
        return {
          imageDescription,
          imageUrl: `placeholder-image-${index + 1}.jpg`,
        };
      }
    });

    // Wait for all image generation promises to resolve
    const imageResults = await Promise.all(imageGenerationPromises);

    // Separate image descriptions and URLs
    const imageDescriptions = imageResults.map(
      (result) => result.imageDescription
    );
    const imageUrls = imageResults.map((result) => result.imageUrl);

    return {
      characterPrompt,
      characterImageUrl,
      characterName,
      style,
      storyTheme,
      pages,
      title,
      setting,
      imageDescriptions,
      imageUrls,
    };
  },
});

// Step 3: Combine Story
const combineStoryStep = createStep({
  id: "combineStory",
  inputSchema: z.object({
    characterPrompt: z.string(),
    characterImageUrl: z.string(),
    characterName: z.string(),
    style: z.string(),
    storyTheme: z.string(),
    pages: z.array(z.string()),
    title: z.string(),
    setting: z.string(),
    imageDescriptions: z.array(z.string()),
    imageUrls: z.array(z.string()),
  }),
  outputSchema: z.object({
    completeStory: z.object({
      title: z.string(),
      setting: z.string(),
      pages: z.array(
        z.object({
          text: z.string(),
          // imageDescription: z.string(),
          image: z.string(),
        })
      ),
    }),
  }),
  execute: async ({ inputData, mastra }) => {
    // Get results from previous steps
    const { title, setting, pages, imageUrls } = inputData;

    // Extract title, setting, pages, and image data
    // const title = storyResult?.title || "My Story";
    // const setting = storyResult?.setting || "A magical world";
    // const pages = storyResult?.pages || [];
    // const imageDescriptions = imagesResult?.imageDescriptions || [];
    // const imageUrls = imagesResult?.imageUrls || [];

    // Combine pages and image data
    const combinedPages = pages.map((text, index) => ({
      text,
      // imageDescription:
      //   imageDescriptions[index] || `Illustration for page ${index + 1}`,
      image: imageUrls[index] || `placeholder-image-${index + 1}.jpg`,
    }));

    return {
      completeStory: {
        title,
        setting,
        pages: combinedPages,
      },
    };
  },
});

// Create the Story Workflow
export const storyWorkflow = createWorkflow({
  id: "storyWorkflow",
  description: "Generate a story for a children's book",
  inputSchema: z.object({
    characterPrompt: z.string(),
    characterImageUrl: z.string(),
    characterName: z.string(),
    style: z.string(),
    storyTheme: z.string(),
  }),
  outputSchema: z.object({
    completeStory: z.object({
      title: z.string(),
      setting: z.string(),
      pages: z.array(z.string()),
    }),
  }),
})
  .then(generateStoryPagesStep)
  .then(generatePageImagesStep)
  .then(combineStoryStep)
  .commit();
