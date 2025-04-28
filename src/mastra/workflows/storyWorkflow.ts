import { Workflow, Step } from "@mastra/core/workflows";
import { z } from "zod";
import { mastra } from "../index";
import { experimental_generateImage as generateImage } from "ai";
import { openai } from "@ai-sdk/openai";

// Step 1: Generate Story Pages
const generateStoryPagesStep = new Step({
  id: "generateStoryPages",
  outputSchema: z.object({
    pages: z.array(z.string()),
    title: z.string(),
    setting: z.string(),
  }),
  execute: async ({ context }) => {
    const { characterPrompt, storyTheme, targetAgeRange } = context.triggerData;
    const storyGenerator = mastra.getAgent("storyGenerator");

    // Create a prompt for the story generator
    let prompt = `Create a children's story with the following character: ${characterPrompt}.`;

    // Add optional parameters to the prompt if they exist
    if (storyTheme) {
      prompt += ` The theme of the story should be: ${storyTheme}.`;
    }

    if (targetAgeRange) {
      prompt += ` The story should be appropriate for children aged: ${targetAgeRange}.`;
    }

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
      title: response.object.title,
      pages: response.object.pages,
      setting: response.object.setting,
    };
  },
});

// Step 2: Generate Page Images
const generatePageImagesStep = new Step({
  id: "generatePageImages",
  outputSchema: z.object({
    imageDescriptions: z.array(z.string()),
    imageUrls: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    // Get story data from previous step
    const storyResult = context.getStepResult(generateStoryPagesStep);
    const { characterPrompt } = context.triggerData;
    const imageWriter = mastra.getAgent("imageWriter");

    if (!storyResult || !storyResult.pages || storyResult.pages.length === 0) {
      return { imageDescriptions: [], imageUrls: [] };
    }

    // Array to store image descriptions and URLs
    const imageDescriptions = [];
    const imageUrls = [];

    // Process each page
    for (let index = 0; index < storyResult.pages.length; index++) {
      const pageText = storyResult.pages[index];

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

Story Setting: "${storyResult.setting}"

Based on this page text, character description, and the overall story setting, create a vivid, detailed image description that captures the essence of this moment in the story. The description should help generate an illustration for a children's book.

Ensure the image description incorporates elements from the story setting and maintains visual consistency throughout the story. Consider lighting, colors, mood, and perspective that best represent this scene.`;

      // Use the imageWriter agent to create the image description
      const response = await imageWriter.generate(prompt, {
        output: outputSchema,
      });

      const imageDescription = response.object.imageDescription;
      imageDescriptions.push(imageDescription);

      // 2. Generate actual image using DALL-E based on the description
      try {
        const { image } = await generateImage({
          model: openai.image("dall-e-3"),
          prompt: imageDescription,
          size: "1024x1024",
          providerOptions: {
            openai: { style: "vivid", quality: "hd" },
          },
        });

        // Store the base64 image data as a Data URL
        const imageUrl = `data:image/png;base64,${image.base64}`;
        imageUrls.push(imageUrl);
      } catch (error) {
        console.error(`Failed to generate image for page ${index + 1}:`, error);
        // If image generation fails, use a placeholder
        imageUrls.push(`placeholder-image-${index + 1}.jpg`);
      }
    }

    return {
      imageDescriptions,
      imageUrls,
    };
  },
});

// Step 3: Combine Story
const combineStoryStep = new Step({
  id: "combineStory",
  outputSchema: z.object({
    completeStory: z.object({
      title: z.string(),
      setting: z.string(),
      pages: z.array(
        z.object({
          text: z.string(),
          imageDescription: z.string(),
          imageUrl: z.string(),
        })
      ),
    }),
  }),
  execute: async ({ context }) => {
    // Get results from previous steps
    const storyResult = context.getStepResult(generateStoryPagesStep);
    const imagesResult = context.getStepResult(generatePageImagesStep);

    // Extract title, setting, pages, and image data
    const title = storyResult?.title || "My Story";
    const setting = storyResult?.setting || "A magical world";
    const pages = storyResult?.pages || [];
    const imageDescriptions = imagesResult?.imageDescriptions || [];
    const imageUrls = imagesResult?.imageUrls || [];

    // Combine pages and image data
    const combinedPages = pages.map((text, index) => ({
      text,
      imageDescription:
        imageDescriptions[index] || `Illustration for page ${index + 1}`,
      imageUrl: imageUrls[index] || `placeholder-image-${index + 1}.jpg`,
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
export const storyWorkflow = new Workflow({
  name: "storyWorkflow",
  triggerSchema: z.object({
    characterPrompt: z.string(),
    storyTheme: z.string().optional(),
    targetAgeRange: z.string().optional(),
  }),
});

// Set up the workflow steps in sequence
storyWorkflow
  .step(generateStoryPagesStep)
  .then(generatePageImagesStep)
  .then(combineStoryStep)
  .commit();
