import { Workflow, Step } from "@mastra/core/workflows";
import { z } from "zod";
import { mastra } from "../index";
import { experimental_generateImage as generateImage } from "ai";
import { openai } from "@ai-sdk/openai";

// Define the Enhance Character step
const enhanceCharacterStep = new Step({
  id: "enhanceCharacter",
  outputSchema: z.object({
    enhancedCharacter: z.string(),
  }),
  execute: async ({ context }) => {
    // Get the basic character description from the trigger data
    const basicCharacterDescription = context.triggerData.characterDescription;
    const characterWriter = mastra.getAgent("characterWriter");

    // Use the characterWriter agent to enhance the character description
    const response = await characterWriter.generate(
      `Transform this basic character description into a detailed character: ${basicCharacterDescription}`
    );

    return {
      enhancedCharacter: response.text,
    };
  },
});

// Define the Generate Character step - this step generates images
const generateCharacterStep = new Step({
  id: "generateCharacter",
  outputSchema: z.object({
    characterImages: z.array(z.string()),
    enhancedCharacter: z.string(),
  }),
  execute: async ({ context }) => {
    // Get the enhanced character description from the previous step
    const prevStepResult = context.getStepResult(enhanceCharacterStep);
    const style = context.triggerData.style;
    const enhancedCharacter = prevStepResult?.enhancedCharacter || "";

    // Generate three different character images
    const characterImages = [];
    const numImages = 3;

    // Prepare image generation prompt
    const imagePrompt = `Create a children's book illustration of this character: ${enhancedCharacter}. 
    The illustration should be vibrant, expressive, and suitable for a children's story. 
    Show the full character with a simple background that highlights their key features.
    ${style}`;

    try {
      // Generate multiple images in one call
      const { images } = await generateImage({
        model: openai.image("gpt-image-1"),
        prompt: imagePrompt,
        n: numImages,
        size: "1024x1024",
        providerOptions: {
          openai: { quality: "medium" },
        },
      });

      // Process each generated image
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const imageUrl = `data:image/png;base64,${image.base64}`;
        characterImages.push(imageUrl);
      }
    } catch (error) {
      console.error("Failed to generate character images:", error);
      // If image generation fails, use placeholders
      for (let i = 0; i < numImages; i++) {
        characterImages.push(`placeholder-character-${i + 1}.jpg`);
      }
    }

    return {
      characterImages,
      enhancedCharacter,
    };
  },
});

// Create the master workflow
export const generateCharactersWorkflow = new Workflow({
  name: "generateCharacters",
  triggerSchema: z.object({
    characterDescription: z.string(),
    style: z.string(),
  }),
});

// Set up the workflow steps in sequence
generateCharactersWorkflow
  .step(enhanceCharacterStep)
  .then(generateCharacterStep)
  .commit();
