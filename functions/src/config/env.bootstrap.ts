import dotenv from "dotenv";
import path from "path";

let envLoaded = false;

export const loadEnvironment = (): void => {
  if (envLoaded) {
    return;
  }

  dotenv.config({
    path: path.resolve(__dirname, "../../.env"),
  });
  dotenv.config({
    path: path.resolve(__dirname, "../../.env.local"),
    override: true,
  });

  envLoaded = true;
};

loadEnvironment();
