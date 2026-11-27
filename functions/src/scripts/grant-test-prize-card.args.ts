export type GrantTestCardArgs = {
  email?: string;
  uid?: string;
  diseno: string;
  revoke: boolean;
  list: boolean;
};

/**
 * Lee los argumentos de grant-test-prize-card. Cada opción con valor exige
 * uno real: `--uid --list` es un error, no una carta para el uid "--list".
 */
export function parseGrantTestCardArgs(argv: string[]): GrantTestCardArgs {
  const args: GrantTestCardArgs = { diseno: "globo", revoke: false, list: false };

  const valueAfter = (flag: string, index: number): string => {
    const value = argv[index + 1]?.trim();
    if (!value || value.startsWith("--")) {
      throw new Error(`Falta el valor de ${flag}.`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case "--email":
        args.email = valueAfter(flag, i);
        i += 1;
        break;
      case "--uid":
        args.uid = valueAfter(flag, i);
        i += 1;
        break;
      case "--diseno":
        args.diseno = valueAfter(flag, i);
        i += 1;
        break;
      case "--revoke":
        args.revoke = true;
        break;
      case "--list":
        args.list = true;
        break;
      default:
        throw new Error(`Opción desconocida: ${flag}`);
    }
  }

  if (!args.email && !args.uid) {
    throw new Error("Indica la cuenta con --email o --uid.");
  }
  return args;
}
