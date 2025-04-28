import { Mastra } from "@mastra/core";
import { storyGenerator, characterWriter, imageWriter } from "./agents";
import { generateCharactersWorkflow, storyWorkflow } from "./workflows";

export const mastra = new Mastra({
  agents: { storyGenerator, characterWriter, imageWriter },
  workflows: { generateCharactersWorkflow, storyWorkflow },
});
