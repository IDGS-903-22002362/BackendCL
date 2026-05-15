import dotenv from "dotenv";
import path from "path";

let envLoaded = false;

export const loadEnvironment = (): void => {
  if (envLoaded) {
    return;
  }

  if (process.env.FUNCTION_NAME || process.env.K_SERVICE) {
    envLoaded = true;
    return;
  }

  dotenv.config({
    path: path.resolve(__dirname, "../../.env"),
  });
  dotenv.config({
    path: path.resolve(__dirname, "../../.env.local"),
    override: true,
  });
  dotenv.config({
    path: path.resolve(__dirname, "../../.secret.local"),
    override: true,
  });

  envLoaded = true;
};

loadEnvironment();
