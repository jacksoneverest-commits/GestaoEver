const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readInput() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf-8');
  } catch (err) {
    raw = '';
  }
  try {
    return JSON.parse(raw || '{}');
  } catch (err) {
    return {};
  }
}

function getCommand(input) {
  return (input.tool_input && input.tool_input.command) || '';
}

function getFilePath(input) {
  const ti = input.tool_input || {};
  return ti.file_path || ti.path || '';
}

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/');
}

function block(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}

function allow() {
  process.exit(0);
}

function projectRoot(input) {
  return input.cwd || process.cwd();
}

function runNpmTest(cwd) {
  const result = spawnSync('npm', ['test'], {
    cwd,
    encoding: 'utf-8',
    shell: true,
  });
  return {
    passed: result.status === 0,
    output: `${result.stdout || ''}\n${result.stderr || ''}`.trim(),
  };
}

module.exports = {
  readInput,
  getCommand,
  getFilePath,
  normalizePath,
  block,
  allow,
  projectRoot,
  runNpmTest,
  path,
};
