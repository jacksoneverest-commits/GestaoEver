import { spawnSync } from "node:child_process";

/**
 * OpenCode plugin: aplica os mesmos guard-rails dos agents do Claude Code
 * (.claude/agents/*.md + .claude/hooks/*), verificando o nome do agent em
 * cada hook. A forma exata dos hooks (nomes de evento, campos do contexto)
 * pode variar entre versões da API de plugins do OpenCode — ajuste os nomes
 * dos métodos abaixo conforme a versão instalada; a lógica de negócio
 * (o que é bloqueado, por quê) é o que deve ser preservado.
 */

type ToolContext = {
  agent?: string;
  tool: string;
  input: Record<string, any>;
  cwd?: string;
};

const LEGACY_TABLES = [
  "vendacupom",
  "vendaitem",
  "produto",
  "clifor",
  "setor",
  "grupo",
  "familia",
  "formapag",
  "flagvc",
];

function normalize(p: string): string {
  return String(p || "").replace(/\\/g, "/");
}

function isFrontendPath(p: string): boolean {
  return normalize(p).includes("frontend/");
}

function isBackendPath(p: string): boolean {
  return normalize(p).includes("backend/");
}

function getCommand(ctx: ToolContext): string {
  return String(ctx.input?.command ?? "");
}

function getFilePath(ctx: ToolContext): string {
  return normalize(String(ctx.input?.filePath ?? ctx.input?.file_path ?? ctx.input?.path ?? ""));
}

function blockedDestructiveSql(command: string): string | null {
  const match = command.match(/\b(DROP|ALTER|TRUNCATE)\s+TABLE\s+`?(\w+)`?/i);
  if (match && LEGACY_TABLES.includes(match[2].toLowerCase())) {
    return (
      `database-engineer: comando destrutivo (${match[1].toUpperCase()}) contra a tabela do ERP existente "${match[2]}" foi bloqueado. ` +
      "Este agent só pode criar tabelas novas de cache/histórico — nunca alterar o schema do sistema legado."
    );
  }
  if (/\bDROP\s+DATABASE\b/i.test(command)) {
    return 'database-engineer: "DROP DATABASE" é uma operação destrutiva irreversível e nunca é permitida.';
  }
  return null;
}

function runTests(cwd: string): { passed: boolean; output: string } {
  const result = spawnSync("npm", ["test"], { cwd, encoding: "utf-8", shell: true });
  return {
    passed: result.status === 0,
    output: `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
  };
}

export default {
  name: "agent-hooks",

  // Executado antes de qualquer tool call (Bash/Write/Edit) de um agent.
  // Lançar um erro aqui equivale ao "exit 2" dos hooks do Claude Code: bloqueia a ação.
  "tool.execute.before": async (ctx: ToolContext) => {
    const agent = ctx.agent ?? "unknown";
    const command = getCommand(ctx);
    const filePath = getFilePath(ctx);

    if (/\bgit\s+push\b/i.test(command)) {
      throw new Error(
        `${agent}: "git push" está fora de escopo de qualquer agent de implementação — peça confirmação explícita ao usuário e faça o push manualmente.`
      );
    }

    if (agent === "backend-engineer") {
      if (filePath && isFrontendPath(filePath)) {
        throw new Error(
          `backend-engineer: este agent só edita arquivos em backend/. O caminho "${filePath}" pertence ao frontend, escopo do agent frontend-engineer.`
        );
      }
      if (filePath.includes("backend/src/db/migrations/")) {
        throw new Error("backend-engineer: migrations de banco são escopo do agent database-engineer.");
      }
      if (/\b(DROP|ALTER|TRUNCATE)\s+TABLE\b/i.test(command)) {
        throw new Error("backend-engineer: comandos destrutivos de schema não são responsabilidade deste agent — isso é escopo do database-engineer.");
      }
    }

    if (agent === "frontend-engineer") {
      if (filePath && isBackendPath(filePath)) {
        throw new Error(
          `frontend-engineer: este agent só edita arquivos em frontend/. O caminho "${filePath}" pertence ao backend, escopo do agent backend-engineer.`
        );
      }
      if (/\b(mysql|mariadb)\b/i.test(command)) {
        throw new Error("frontend-engineer: este agent não acessa o banco de dados diretamente — toda leitura de dados vem da API do backend.");
      }
    }

    if (agent === "database-engineer") {
      if (filePath && (isFrontendPath(filePath) || filePath.includes("backend/src/modules/"))) {
        throw new Error("database-engineer: controllers/services de API e código de UI não são escopo deste agent.");
      }
      const sqlBlockReason = blockedDestructiveSql(command);
      if (sqlBlockReason) {
        throw new Error(sqlBlockReason);
      }
    }
  },

  // Executado depois de Write/Edit — roda os testes do módulo tocado e reporta falhas.
  "tool.execute.after": async (ctx: ToolContext) => {
    const agent = ctx.agent ?? "unknown";
    const filePath = getFilePath(ctx);
    if (!filePath || (ctx.tool !== "write" && ctx.tool !== "edit")) return;

    if (agent === "backend-engineer" && isBackendPath(filePath)) {
      const { passed, output } = runTests("backend");
      if (!passed) console.error(`[backend-engineer] testes do backend falharam após editar "${filePath}":\n${output}`);
    }

    if (agent === "frontend-engineer" && isFrontendPath(filePath)) {
      const { passed, output } = runTests("frontend");
      if (!passed) console.error(`[frontend-engineer] testes do frontend falharam após editar "${filePath}":\n${output}`);
    }

    if (agent === "database-engineer" && (filePath.includes("backend/src/db/") || filePath.includes("backend/src/jobs/"))) {
      const { passed, output } = runTests("backend");
      if (!passed) console.error(`[database-engineer] testes do backend falharam após editar "${filePath}":\n${output}`);
    }
  },

  // Executado antes do agent encerrar a sessão/task — bloqueia o encerramento se os testes do módulo estiverem falhando.
  "session.stop.before": async (ctx: { agent?: string }) => {
    const agent = ctx.agent ?? "unknown";

    if (agent === "backend-engineer" || agent === "database-engineer") {
      const { passed, output } = runTests("backend");
      if (!passed) throw new Error(`${agent}: não é possível encerrar — os testes do backend estão falhando:\n${output}`);
    }

    if (agent === "frontend-engineer") {
      const { passed, output } = runTests("frontend");
      if (!passed) throw new Error(`frontend-engineer: não é possível encerrar — os testes do frontend estão falhando:\n${output}`);
    }
  },
};
