import { createLogger, Mastra } from "@mastra/core";
import { storyGenerator, characterWriter, imageWriter } from "./agents";
import { generateCharactersWorkflow, storyWorkflow } from "./workflows";
import { LibSQLStore } from "@mastra/libsql";

export const mastra = new Mastra({
  agents: { storyGenerator, characterWriter, imageWriter },
  workflows: { generateCharactersWorkflow, storyWorkflow },
  storage: new LibSQLStore({
    url: "file:../mastra.db",
  }),
  logger: createLogger({
    name: "Fable Frames",
    level: "debug",
  }),
});
