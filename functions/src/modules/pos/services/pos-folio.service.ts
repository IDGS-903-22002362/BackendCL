/**
 * Folios legibles del POS.
 *
 * El ID técnico del documento siempre es el autogenerado de Firestore; el folio es un
 * identificador humano. Los contadores se particionan por tipo, fecha operativa y caja para
 * evitar un documento global altamente contendido (DEC-10).
 */

import type { OperationalDate } from "../models/pos.types";
import { posSequenceRepository } from "../repositories/pos-support.repository";

export type PosFolioKind = "SALE" | "CUT" | "RETURN" | "INCIDENT" | "EXPORT";

const PREFIX_BY_KIND: Readonly<Record<PosFolioKind, string>> = Object.freeze({
  SALE: "V",
  CUT: "C",
  RETURN: "D",
  INCIDENT: "I",
  EXPORT: "X",
});

function compactDate(operationalDate: OperationalDate): string {
  return operationalDate.replace(/-/g, "");
}

interface FolioScope {
  scope: string;
  prefix: string;
}

/**
 * Los folios de venta, corte y devolución se particionan por caja; incidencias y
 * exportaciones son de bajo volumen y se particionan solo por día.
 */
function resolveScope(
  kind: PosFolioKind,
  operationalDate: OperationalDate,
  registerCode?: string,
): FolioScope {
  const base = PREFIX_BY_KIND[kind];
  const day = compactDate(operationalDate);

  if (registerCode && (kind === "SALE" || kind === "CUT" || kind === "RETURN")) {
    return {
      scope: `${kind}:${operationalDate}:${registerCode}`,
      prefix: `${base}-${registerCode}-${day}`,
    };
  }

  return {
    scope: `${kind}:${operationalDate}`,
    prefix: `${base}-${day}`,
  };
}

class PosFolioService {
  async next(
    kind: PosFolioKind,
    operationalDate: OperationalDate,
    registerCode?: string,
  ): Promise<string> {
    const { scope, prefix } = resolveScope(kind, operationalDate, registerCode);
    return posSequenceRepository.next(scope, prefix);
  }

  /**
   * Folio reservado dentro de una transacción ya abierta.
   *
   * Requiere que el llamador haya leído el contador con `readValueInTransaction` durante la
   * fase de lecturas, porque Firestore no permite leer después de escribir.
   */
  reserveInTransaction(
    transaction: FirebaseFirestore.Transaction,
    kind: PosFolioKind,
    operationalDate: OperationalDate,
    currentValue: number,
    registerCode?: string,
  ): string {
    const { scope, prefix } = resolveScope(kind, operationalDate, registerCode);
    return posSequenceRepository.reserveInTransaction(
      transaction,
      scope,
      prefix,
      currentValue,
    );
  }

  async readValueInTransaction(
    transaction: FirebaseFirestore.Transaction,
    kind: PosFolioKind,
    operationalDate: OperationalDate,
    registerCode?: string,
  ): Promise<number> {
    const { scope } = resolveScope(kind, operationalDate, registerCode);
    const snapshot = await transaction.get(
      posSequenceRepository.sequenceRef(scope),
    );
    return (snapshot.data()?.value as number | undefined) ?? 0;
  }
}

export const posFolioService = new PosFolioService();
export default posFolioService;
