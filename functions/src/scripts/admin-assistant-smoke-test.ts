/**
 * Smoke test real del Asistente Administrativo.
 *
 * Ejecuta el flujo completo: pregunta -> Gemini -> tools read-only ->
 * Firestore real -> Gemini (structured output) -> informe con bloques.
 *
 * Uso:
 *   npm run test:admin-assistant:smoke
 *   npm run test:admin-assistant:smoke -- "¿Como vamos este mes?"
 *   npm run test:admin-assistant:smoke -- --json "¿Como vamos este mes?"
 *   npm run test:admin-assistant:smoke -- --suite
 *   npm run test:admin-assistant:smoke -- --eval
 *
 * `--suite` corre la conversacion de aceptacion de la fase 2 (trafico,
 * interes de productos, prioridades y pronostico) reutilizando el historial
 * para validar preguntas de seguimiento. `--eval` corre el conjunto completo
 * de evaluacion de capacidades e imprime las tools usadas por pregunta.
 *
 * Requiere GEMINI_API_KEY (misma credencial del resto de la IA) y acceso a
 * Firestore. No imprime secretos, prompts completos ni datos de clientes.
 */

import "../config/env.bootstrap";
import { RolUsuario } from "../models/usuario.model";
import adminReportAgent, {
  type AdminAgentHistoryEntry,
} from "../services/ai/analytics/admin-report.agent";

const DEFAULT_QUESTION = "¿Cuanto vendimos recientemente?";

/** Conversacion minima de aceptacion de la fase 2. */
const SUITE_QUESTIONS = [
  "¿Como vamos recientemente?",
  "¿Que productos estan llamando mas la atencion?",
  "¿Que deberiamos atender?",
  "Proyecta las ventas de los proximos 7 dias.",
];

/**
 * Conjunto de evaluacion de capacidades: cada pregunta debe resolverse con
 * herramientas reales. Se corre con `--eval` porque consume cuota de Gemini.
 */
const EVAL_QUESTIONS = [
  "¿Cuales fueron los productos mas visitados esta semana?",
  "¿Que producto tiene muchas visitas pero pocas ventas?",
  "¿Que producto convierte mejor?",
  "¿Como esta nuestro trafico?",
  "¿Que dia recibimos mas visitas?",
  "¿Donde perdemos mas clientes en el funnel?",
  "¿Las visitas estan creciendo?",
  "¿Las ventas crecieron al mismo ritmo que las visitas?",
  "¿Que productos estan ganando interes?",
  "¿Que productos estan perdiendo interes?",
  "¿Ves alguna anomalia?",
  "Predice las ventas de los proximos 7 dias.",
  "¿Como podria cerrar este mes?",
  "¿Que deberiamos promocionar?",
  "Dame tres opciones.",
  "¿Cual elegirias y por que?",
  "Muestrame una grafica.",
  "Ahora comparalo con el mes pasado.",
];

const runQuestion = async (input: {
  question: string;
  history: AdminAgentHistoryEntry[];
  printJson: boolean;
}) => {
  console.log(`SMOKE  | pregunta="${input.question}"`);
  const startedAt = Date.now();

  for await (const event of adminReportAgent.run({
    question: input.question,
    userId: "smoke-admin",
    role: RolUsuario.ADMIN,
    requestId: `smoke-${Date.now()}`,
    history: input.history,
  })) {
    if (event.type === "status") {
      console.log(`STATUS | ${event.data.status}`);
      continue;
    }

    const { report, trace } = event.data;

    console.log(
      `TOOLS  | ${trace.toolsUsed.join(", ") || "ninguna"} (rondas=${trace.investigationRounds})`,
    );
    for (const call of trace.toolCalls) {
      console.log(
        `  - ${call.toolName} | periodo=${call.periodLabel || "n/d"} | ok=${call.success} | ${call.durationMs}ms | bytes=${call.resultSize}${
          call.errorMessage ? ` | error=${call.errorMessage}` : ""
        }`,
      );
    }

    console.log(`MODEL  | ${trace.model} | tz=${trace.timeZone}`);
    console.log(`BLOQUES| ${report.blocks.map((block) => block.type).join(", ")}`);

    for (const forecast of trace.forecasts || []) {
      console.log(
        `FORECAST| ${forecast.metric} | metodo=${forecast.method} | obs=${forecast.observations} | horizonte=${forecast.horizon} | calidad=${forecast.quality} | mae=${forecast.mae ?? "n/d"}`,
      );
    }

    if (trace.anomaliesDetected) {
      console.log(`ANOMAL | detectadas=${trace.anomaliesDetected}`);
    }

    if (report.suggestedQuestions?.length) {
      console.log(`SUGIERE| ${report.suggestedQuestions.join(" | ")}`);
    }

    console.log(`CONF   | ${report.confidence}`);
    console.log(`RESUMEN| ${report.summary}`);
    console.log(`TIEMPO | ${Date.now() - startedAt}ms`);

    if (input.printJson) {
      console.log(JSON.stringify(report, null, 2));
    }

    return report.summary;
  }

  return "";
};

const main = async () => {
  if (!process.env.GEMINI_API_KEY) {
    console.log("SKIP | admin-assistant-smoke | GEMINI_API_KEY no disponible");
    process.exit(0);
  }

  const args = process.argv.slice(2);
  const printJson = args.includes("--json");
  const runSuite = args.includes("--suite");
  const runEval = args.includes("--eval");
  const inlineQuestion = args
    .filter((arg) => !arg.startsWith("--"))
    .join(" ")
    .trim();

  let questions = [inlineQuestion || DEFAULT_QUESTION];
  if (runEval) {
    questions = EVAL_QUESTIONS;
  } else if (runSuite) {
    questions = SUITE_QUESTIONS;
  }

  const startedAt = Date.now();
  const history: AdminAgentHistoryEntry[] = [];

  for (const question of questions) {
    const summary = await runQuestion({ question, history, printJson });
    history.push({ role: "user", content: question });
    if (summary) {
      history.push({ role: "assistant", content: summary });
    }
    console.log("---");
  }

  console.log(`DONE   | durationMs=${Date.now() - startedAt}`);
};

main().catch((error) => {
  console.error(
    `FAIL | ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
