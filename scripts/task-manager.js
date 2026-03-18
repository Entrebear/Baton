#!/usr/bin/env node
/**
 * task-manager.js  --  Baton skill helper
 *
 * Commands:
 *   --list-incomplete
 *   --status --agent <agentId>        (tasks for this agent only)
 *   --all-status                       (all agents, elevated only -- checked by caller)
 *   --create <json>
 *   --update-task <taskId> <patch>
 *   --update-subtask <taskId> <subtaskId> <patch>
 *   --get <taskId>
 *   --archive <taskId>
 *   --extract-partial --transcript-path <path>
 *   --find-transcript <sessionId> [agentId]
 *   --write-checkpoint <taskId>
 *   --search <keywords>
 *   --rerun <taskId>
 *   --save-template <json>
 *   --list-templates
 *   --get-template <name|id>
 *   --estimate-tokens <text>
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const HOME          = process.env.HOME || process.env.USERPROFILE;
const BATON_DIR     = path.join(HOME, '.openclaw', 'baton');
const TASKS_DIR     = path.join(BATON_DIR, 'tasks');
const ARCHIVE_DIR   = path.join(BATON_DIR, 'archive');
const TEMPLATES_DIR = path.join(BATON_DIR, 'templates');
const CHECKPOINTS_DIR = path.join(BATON_DIR, 'checkpoints');
const OUTPUTS_DIR   = path.join(HOME, '.openclaw', 'workspace', 'baton-outputs');
const AGENTS_DIR    = path.join(HOME, '.openclaw', 'agents');

// --- Utilities ----------------------------------------------------------------

function ensureDirs() {
  [BATON_DIR, TASKS_DIR, ARCHIVE_DIR, TEMPLATES_DIR, CHECKPOINTS_DIR, OUTPUTS_DIR]
    .forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function now()  { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function log(msg) { process.stderr.write(`[task-manager] ${msg}\n`); }

function estimateTokens(text) {
  if (!text) return 0;
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  return Math.ceil(s.length / 4);
}

function slugify(str) {
  return (str || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-$/, '');
}

// --- Task file helpers --------------------------------------------------------

const PRIORITY_ORDER = { urgent: 0, normal: 1, background: 2 };

function activePath(taskId)  { return path.join(TASKS_DIR, `${taskId}.json`); }
function archivePath(taskId) { return path.join(ARCHIVE_DIR, `${taskId}.done.json`); }

function loadTask(taskId) {
  return readJson(activePath(taskId)) ?? readJson(archivePath(taskId));
}

function saveTask(task) {
  if (!fs.existsSync(activePath(task.taskId)) && fs.existsSync(archivePath(task.taskId))) {
    log(`WARNING: task ${task.taskId} is already archived; skipping save`);
    return;
  }
  task.updatedAt = now();
  writeJson(activePath(task.taskId), task);
}

function autoUpdateTaskStatus(task) {
  if (!task.subtasks?.length) return task;
  const statuses = task.subtasks.map(s => s.status);
  const TERMINAL = new Set(['done', 'failed', 'skipped_dependency']);
  if (statuses.every(s => s === 'done')) {
    task.status = 'done';
  } else if (statuses.every(s => TERMINAL.has(s))) {
    task.status = statuses.some(s => s === 'done') ? 'partial' : 'failed';
  } else {
    task.status = 'running';
  }
  return task;
}

/** Build a summary object for a task, used by both status commands */
function taskSummary(task) {
  const subs = task.subtasks || [];
  return {
    taskId:          task.taskId,
    goal:            task.goal,
    status:          task.status,
    priority:        task.priority || 'normal',
    createdAt:       task.createdAt,
    orchestratorAgent: task.orchestratorAgent ?? null,
    progress:        `${subs.filter(s => s.status === 'done').length}/${subs.length} subtasks done`,
    running:         subs.filter(s => s.status === 'running')
                        .map(s => ({ id: s.id, model: s.model, attempts: s.attempts })),
    pending:         subs.filter(s => s.status === 'pending').length,
    failed:          subs.filter(s => s.status === 'failed').length,
    actualCost:      task.actualCost || 0,
    budgetCap:       task.budgetCap || null
  };
}

function loadAllActiveTasks() {
  ensureDirs();
  return fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(TASKS_DIR, f)))
    .filter(t => t && t.status !== 'done');
}

// --- Commands -----------------------------------------------------------------

function listIncomplete() {
  const tasks = loadAllActiveTasks();
  const results = tasks.map(task => {
    const subs = task.subtasks || [];
    return {
      taskId:       task.taskId,
      goal:         task.goal,
      status:       task.status,
      priority:     task.priority || 'normal',
      createdAt:    task.createdAt,
      orchestratorAgent: task.orchestratorAgent ?? null,
      progress:     `${subs.filter(s => s.status === 'done').length}/${subs.length} subtasks done`,
      failedCount:  subs.filter(s => s.status === 'failed').length,
      deadSessions: subs.filter(s => s.status === 'running' && s.sessionKey)
                       .map(s => ({ subtaskId: s.id, sessionKey: s.sessionKey, transcriptPath: s.transcriptPath ?? null }))
    };
  });

  results.sort((a, b) => {
    const pd = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
    return pd !== 0 ? pd : new Date(a.createdAt) - new Date(b.createdAt);
  });

  console.log(JSON.stringify({ incomplete: results, count: results.length }));
}

/**
 * --status --agent <agentId>
 * Shows active tasks for this specific agent only.
 * Callers must pass the agentId of the agent running the command.
 */
function getAgentStatus(agentId) {
  if (!agentId) { log('ERROR: --status requires --agent <agentId>'); process.exit(1); }

  const tasks = loadAllActiveTasks()
    .filter(t => t.orchestratorAgent === agentId)
    .map(taskSummary)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1));

  console.log(JSON.stringify({
    agentId,
    activeTasks: tasks,
    count: tasks.length,
    totalRunningSubagents: tasks.reduce((n, t) => n + t.running.length, 0),
    totalCost: tasks.reduce((n, t) => n + t.actualCost, 0)
  }));
}

/**
 * --all-status
 * Instance-wide view, grouped by orchestratorAgent.
 * MUST only be called after the conductor has verified elevated privileges.
 * The check is done in the skill (SKILL.md SS Status Commands) before invoking this.
 */
function getAllStatus() {
  const tasks = loadAllActiveTasks().map(taskSummary);

  // Group by orchestratorAgent
  const byAgent = {};
  for (const t of tasks) {
    const key = t.orchestratorAgent ?? 'unknown';
    (byAgent[key] ??= []).push(t);
  }

  // Sort within each agent group by priority
  for (const group of Object.values(byAgent)) {
    group.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1));
  }

  const agentSummaries = Object.entries(byAgent).map(([agentId, agentTasks]) => ({
    agentId,
    taskCount: agentTasks.length,
    runningSubagents: agentTasks.reduce((n, t) => n + t.running.length, 0),
    totalCost: agentTasks.reduce((n, t) => n + t.actualCost, 0),
    tasks: agentTasks
  }));

  console.log(JSON.stringify({
    instanceTotal: tasks.length,
    totalRunningSubagents: tasks.reduce((n, t) => n + t.running.length, 0),
    totalCost: tasks.reduce((n, t) => n + t.actualCost, 0),
    agents: agentSummaries
  }));
}

function createTask(jsonStr) {
  ensureDirs();
  let data;
  try { data = JSON.parse(jsonStr); }
  catch { log('ERROR: invalid JSON'); process.exit(1); }

  const task = {
    taskId:            data.taskId || uuid(),
    goal:              data.goal || 'Unknown goal',
    createdAt:         now(),
    updatedAt:         now(),
    status:            'running',
    priority:          data.priority || 'normal',
    userChannel:       data.userChannel ?? null,
    orchestratorAgent: data.orchestratorAgent ?? null,
    budgetCap:         data.budgetCap ?? null,
    actualCost:        0,
    outputFile:        data.outputFile ?? null,
    templateId:        data.templateId ?? null,
    rerunOf:           data.rerunOf ?? null,
    subtasks: (data.subtasks || []).map(s => ({
      id:                   s.id,
      description:          s.description,
      dependsOn:            s.dependsOn || [],
      fanInPolicy:          s.fanInPolicy || 'all',
      targetAgent:          s.targetAgent ?? null,
      status:               'pending',
      model:                null,
      sessionKey:           null,
      sessionId:            null,
      transcriptPath:       null,
      startedAt:            null,
      completedAt:          null,
      attempts:             0,
      output:               null,
      outputSummary:        null,
      estimatedInputTokens: s.estimatedInputTokens ?? null,
      contextStrategy:      s.contextStrategy ?? null,
      definitionOfDone:     s.definitionOfDone ?? null,
      validationResult:     null,
      failureReason:        null,
      sideEffects:          []
    })),
    parallelGroups: data.parallelGroups || [],
    finalSynthesis: null
  };

  saveTask(task);
  console.log(JSON.stringify({ ok: true, taskId: task.taskId, path: activePath(task.taskId) }));
}

function updateTask(taskId, patchJson) {
  const task = loadTask(taskId);
  if (!task) { log(`ERROR: task ${taskId} not found`); process.exit(1); }

  let patch;
  try { patch = JSON.parse(patchJson); }
  catch { log('ERROR: invalid JSON patch'); process.exit(1); }

  // Cost accumulation
  if (patch.addCost) {
    task.actualCost = (task.actualCost || 0) + patch.addCost;
    delete patch.addCost;
  }

  // Never allow patching subtasks or immutable identity fields via this command
  const { subtasks, taskId: _tid, createdAt: _cat, orchestratorAgent: _oa, ...rest } = patch;
  Object.assign(task, rest);

  saveTask(task);
  console.log(JSON.stringify({ ok: true, taskId, status: task.status }));
}

function updateSubtask(taskId, subtaskId, patchJson) {
  const task = loadTask(taskId);
  if (!task) { log(`ERROR: task ${taskId} not found`); process.exit(1); }

  let patch;
  try { patch = JSON.parse(patchJson); }
  catch { log('ERROR: invalid JSON patch'); process.exit(1); }

  const sub = task.subtasks?.find(s => s.id === subtaskId);
  if (!sub) { log(`ERROR: subtask ${subtaskId} not found in ${taskId}`); process.exit(1); }

  if (patch.sideEffect) {
    sub.sideEffects = sub.sideEffects || [];
    sub.sideEffects.push({ ...patch.sideEffect, recordedAt: now() });
    delete patch.sideEffect;
  }

  if (patch.addCost) {
    task.actualCost = (task.actualCost || 0) + patch.addCost;
    delete patch.addCost;
  }

  Object.assign(sub, patch);
  autoUpdateTaskStatus(task);
  saveTask(task);
  console.log(JSON.stringify({ ok: true, taskId, subtaskId, taskStatus: task.status }));
}

function getTask(taskId) {
  const task = loadTask(taskId);
  if (!task) { log(`ERROR: task ${taskId} not found`); process.exit(1); }
  console.log(JSON.stringify(task));
}

function archiveTask(taskId) {
  const task = loadTask(taskId);
  if (!task) { log(`ERROR: task ${taskId} not found`); process.exit(1); }

  if (!fs.existsSync(activePath(taskId))) {
    console.log(JSON.stringify({ ok: true, taskId, note: 'already archived', path: archivePath(taskId) }));
    return;
  }

  task.archivedAt = now();
  writeJson(archivePath(taskId), task);
  fs.unlinkSync(activePath(taskId));

  // Write final output to baton-outputs/
  if (task.finalSynthesis) {
    const filename = task.outputFile || `${task.taskId}-${slugify(task.goal)}.md`;
    const outputPath = path.join(OUTPUTS_DIR, filename);
    ensureDirs();
    fs.writeFileSync(outputPath, [
      `# ${task.goal}`,
      `*Task ID: ${task.taskId} -- Completed: ${task.archivedAt}*`,
      `*Agent: ${task.orchestratorAgent ?? 'unknown'}*`,
      ``,
      task.finalSynthesis
    ].join('\n'));
    console.log(JSON.stringify({ ok: true, taskId, archived: archivePath(taskId), output: outputPath }));
    return;
  }

  console.log(JSON.stringify({ ok: true, taskId, archived: archivePath(taskId) }));
}

function extractPartial(transcriptPath) {
  if (!transcriptPath) {
    console.log(JSON.stringify({ found: false, reason: 'no_path_provided' }));
    return;
  }
  if (!fs.existsSync(transcriptPath)) {
    console.log(JSON.stringify({ found: false, transcriptPath, reason: 'file_not_found' }));
    return;
  }

  const lines = fs.readFileSync(transcriptPath, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  const textOf = entry => {
    if (!entry) return '';
    if (typeof entry.content === 'string') return entry.content;
    if (Array.isArray(entry.content)) return entry.content.map(c => c.text || c.content || '').join('');
    return entry.text || entry.output || entry.result || '';
  };

  const assistantMessages = lines
    .filter(l => l.role === 'assistant' || l.type === 'assistant')
    .map(textOf).filter(Boolean);

  const toolResults = lines
    .filter(l => l.role === 'tool' || l.type === 'tool_result' || l.role === 'tool_result')
    .slice(-3).map(l => textOf(l).slice(0, 500));

  const MUTATION_TOOLS = new Set(['write_file', 'create_file', 'str_replace', 'apply_patch', 'bash', 'exec', 'elevated']);
  const potentialSideEffects = lines
    .filter(l => l.role === 'assistant' && Array.isArray(l.content))
    .flatMap(l => l.content.filter(c => c.type === 'tool_use'))
    .filter(tc => MUTATION_TOOLS.has(tc.name?.toLowerCase()))
    .map(tc => ({ tool: tc.name, args: JSON.stringify(tc.input || {}).slice(0, 150) }));

  const lastMsg = assistantMessages.at(-1) ?? null;

  console.log(JSON.stringify({
    found: true, transcriptPath,
    lineCount: lines.length,
    assistantMessageCount: assistantMessages.length,
    lastAssistantMessage: lastMsg?.slice(0, 2000) ?? null,
    recentToolResults: toolResults,
    potentialSideEffects,
    hasContent: !!lastMsg || toolResults.length > 0,
    estimatedTokensProduced: estimateTokens(lastMsg)
  }));
}

function findTranscript(sessionId, agentId) {
  if (!fs.existsSync(AGENTS_DIR)) {
    console.log(JSON.stringify({ found: false, reason: 'agents_dir_not_found' }));
    return;
  }

  const searchDirs = [];
  if (agentId) searchDirs.push(path.join(AGENTS_DIR, agentId, 'sessions'));
  try {
    fs.readdirSync(AGENTS_DIR)
      .filter(f => f !== agentId && fs.statSync(path.join(AGENTS_DIR, f)).isDirectory())
      .forEach(a => searchDirs.push(path.join(AGENTS_DIR, a, 'sessions')));
  } catch {}

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const match = fs.readdirSync(dir).find(f => f.includes(sessionId));
    if (match) {
      console.log(JSON.stringify({ found: true, transcriptPath: path.join(dir, match), sessionId }));
      return;
    }
  }
  console.log(JSON.stringify({ found: false, sessionId, reason: 'not_found' }));
}

function writeCheckpoint(taskId) {
  ensureDirs();
  const task = loadTask(taskId);
  if (!task) { log(`ERROR: task ${taskId} not found`); process.exit(1); }

  const subs = task.subtasks || [];
  const byStatus = s => subs.filter(t => t.status === s).map(t => t.id).join(', ') || 'none';

  const content = [
    `# Baton Checkpoint`,
    `**Task:** ${task.taskId}`,
    `**Agent:** ${task.orchestratorAgent ?? 'unknown'}`,
    `**Goal:** ${task.goal}`,
    `**Priority:** ${task.priority || 'normal'}`,
    `**Updated:** ${now()}`,
    ``,
    `## Progress`,
    `- Done: ${byStatus('done')}`,
    `- Running: ${byStatus('running')}`,
    `- Pending: ${byStatus('pending')}`,
    `- Failed: ${byStatus('failed')}`,
    ``,
    `## Completed Outputs`,
    ...subs.filter(s => s.status === 'done' && s.outputSummary)
           .map(s => `- **${s.id}**: ${s.outputSummary}`),
    ``,
    `## Cost`,
    `$${(task.actualCost || 0).toFixed(4)}${task.budgetCap ? ` / $${task.budgetCap} cap` : ''}`,
    ``,
    `## Task File`,
    activePath(task.taskId)
  ].join('\n');

  const workspacePath = path.join(HOME, '.openclaw', 'workspace', 'baton-checkpoint.md');
  const localPath = path.join(CHECKPOINTS_DIR, `${taskId}.md`);
  fs.writeFileSync(workspacePath, content);
  fs.writeFileSync(localPath, content);
  console.log(JSON.stringify({ ok: true, paths: [workspacePath, localPath] }));
}

function searchTasks(keywords) {
  ensureDirs();
  const terms = keywords.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];

  const searchDir = (dir, archived) => {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const task = readJson(path.join(dir, file));
      if (!task) continue;
      const corpus = [
        task.goal || '',
        (task.subtasks || []).map(s => s.description || '').join(' '),
        task.finalSynthesis || ''
      ].join(' ').toLowerCase();
      const matched = terms.filter(t => corpus.includes(t)).length;
      if (matched > 0) {
        results.push({
          taskId: task.taskId,
          goal: task.goal,
          status: task.status,
          createdAt: task.createdAt,
          orchestratorAgent: task.orchestratorAgent ?? null,
          archived,
          matchScore: matched / terms.length,
          subtaskCount: (task.subtasks || []).length,
          snippet: task.finalSynthesis?.slice(0, 200) ?? null
        });
      }
    }
  };

  searchDir(TASKS_DIR, false);
  searchDir(ARCHIVE_DIR, true);
  results.sort((a, b) => b.matchScore - a.matchScore || new Date(b.createdAt) - new Date(a.createdAt));
  console.log(JSON.stringify({ results, count: results.length, keywords }));
}

function rerunTask(taskId) {
  const original = loadTask(taskId);
  if (!original) { log(`ERROR: task ${taskId} not found`); process.exit(1); }

  const newTask = {
    ...original,
    taskId:     uuid(),
    createdAt:  now(),
    updatedAt:  now(),
    status:     'running',
    rerunOf:    taskId,
    actualCost: 0,
    finalSynthesis: null,
    subtasks: (original.subtasks || []).map(s => ({
      ...s,
      status: 'pending', model: null, sessionKey: null, sessionId: null,
      transcriptPath: null, startedAt: null, completedAt: null,
      attempts: 0, output: null, outputSummary: null,
      validationResult: null, failureReason: null, sideEffects: []
    }))
  };

  saveTask(newTask);
  console.log(JSON.stringify({ ok: true, newTaskId: newTask.taskId, rerunOf: taskId }));
}

function saveTemplate(jsonStr) {
  ensureDirs();
  let data;
  try { data = JSON.parse(jsonStr); }
  catch { log('ERROR: invalid JSON'); process.exit(1); }

  const template = {
    templateId:      data.templateId || uuid(),
    name:            data.name || 'Unnamed template',
    description:     data.description || '',
    createdAt:       now(),
    subtaskStructure: data.subtaskStructure || data.subtasks || [],
    parallelGroups:  data.parallelGroups || [],
    defaultPriority: data.defaultPriority || 'normal',
    cronJobId:       null,
    tags:            data.tags || []
  };

  writeJson(path.join(TEMPLATES_DIR, `${template.templateId}.template.json`), template);
  console.log(JSON.stringify({ ok: true, templateId: template.templateId, name: template.name }));
}

function listTemplates() {
  ensureDirs();
  if (!fs.existsSync(TEMPLATES_DIR)) { console.log(JSON.stringify({ templates: [], count: 0 })); return; }
  const templates = fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.template.json'))
    .map(f => readJson(path.join(TEMPLATES_DIR, f)))
    .filter(Boolean)
    .map(t => ({ templateId: t.templateId, name: t.name, description: t.description, tags: t.tags, cronJobId: t.cronJobId, createdAt: t.createdAt }));
  console.log(JSON.stringify({ templates, count: templates.length }));
}

function getTemplate(nameOrId) {
  ensureDirs();
  if (!fs.existsSync(TEMPLATES_DIR)) { console.log(JSON.stringify({ found: false })); return; }
  for (const file of fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.template.json'))) {
    const t = readJson(path.join(TEMPLATES_DIR, file));
    if (t && (t.templateId === nameOrId || t.name.toLowerCase() === nameOrId.toLowerCase())) {
      console.log(JSON.stringify({ found: true, template: t }));
      return;
    }
  }
  console.log(JSON.stringify({ found: false, nameOrId }));
}

// --- CLI dispatch -------------------------------------------------------------

const args = process.argv.slice(2);
const cmd  = args[0];

try {
  switch (cmd) {
    case '--list-incomplete': listIncomplete(); break;

    case '--status': {
      const agentIdx = args.indexOf('--agent');
      const agentId = agentIdx !== -1 ? args[agentIdx + 1] : null;
      getAgentStatus(agentId);
      break;
    }

    // NOTE: --all-status privilege check is done by the skill before calling this command.
    // This script trusts that the caller has already verified elevated status.
    case '--all-status': getAllStatus(); break;

    case '--create':
      if (!args[1]) { log('--create requires JSON'); process.exit(1); }
      createTask(args[1]); break;

    case '--update-task':
      if (!args[1] || !args[2]) { log('--update-task requires taskId patch'); process.exit(1); }
      updateTask(args[1], args[2]); break;

    case '--update-subtask':
      if (!args[1] || !args[2] || !args[3]) { log('--update-subtask requires taskId subtaskId patch'); process.exit(1); }
      updateSubtask(args[1], args[2], args[3]); break;

    case '--get':
      if (!args[1]) { log('--get requires taskId'); process.exit(1); }
      getTask(args[1]); break;

    case '--archive':
      if (!args[1]) { log('--archive requires taskId'); process.exit(1); }
      archiveTask(args[1]); break;

    case '--extract-partial': {
      const tpi = args.indexOf('--transcript-path');
      extractPartial(tpi !== -1 ? args[tpi + 1] : args[1]);
      break;
    }

    case '--find-transcript':
      if (!args[1]) { log('--find-transcript requires sessionId'); process.exit(1); }
      findTranscript(args[1], args[2] ?? null); break;

    case '--write-checkpoint':
      if (!args[1]) { log('--write-checkpoint requires taskId'); process.exit(1); }
      writeCheckpoint(args[1]); break;

    case '--search':
      if (!args[1]) { log('--search requires keywords'); process.exit(1); }
      searchTasks(args.slice(1).join(' ')); break;

    case '--rerun':
      if (!args[1]) { log('--rerun requires taskId'); process.exit(1); }
      rerunTask(args[1]); break;

    case '--save-template':
      if (!args[1]) { log('--save-template requires JSON'); process.exit(1); }
      saveTemplate(args[1]); break;

    case '--list-templates': listTemplates(); break;

    case '--get-template':
      if (!args[1]) { log('--get-template requires name or id'); process.exit(1); }
      getTemplate(args[1]); break;

    case '--estimate-tokens':
      if (!args[1]) { log('--estimate-tokens requires text'); process.exit(1); }
      console.log(JSON.stringify({
        tokens: estimateTokens(args.slice(1).join(' ')),
        chars: args.slice(1).join(' ').length,
        note: 'rough estimate (~4 chars/token)'
      }));
      break;

    default:
      log(`Unknown command: ${cmd || '(none)'}`);
      log([
        '--list-incomplete',
        '--status --agent <agentId>',
        '--all-status (elevated only)',
        '--create <json>',
        '--update-task <id> <patch>',
        '--update-subtask <id> <subId> <patch>',
        '--get <id>',
        '--archive <id>',
        '--extract-partial [--transcript-path <path>]',
        '--find-transcript <sessionId> [agentId]',
        '--write-checkpoint <id>',
        '--search <keywords>',
        '--rerun <id>',
        '--save-template <json>',
        '--list-templates',
        '--get-template <name|id>',
        '--estimate-tokens <text>'
      ].join(' | '));
      process.exit(1);
  }
} catch (e) {
  log(`FATAL: ${e.message}\n${e.stack}`);
  process.exit(1);
}
