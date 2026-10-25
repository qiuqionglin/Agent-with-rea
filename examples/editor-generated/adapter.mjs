import { androidTargetKey, connectAndroid, checkAndroid, hierarchy, nodeById, tap, shell } from '../../lib/android.mjs';
import { AppError, canonical, sleep } from '../../lib/sdk.mjs';

const TEXT = 'org.billthefarmer.editor:id/text';
const ACCESS_MESSAGE = 'In order to have access to the Documents and other folders Editor must use the Files or All files access permission depending upon the version of Android. If this is not allowed the app may still be able to access files using the Storage button in the file chooser.';
function fail(code, message, details = {}, status = 4) { throw new AppError(code, message, details, status); }
function optionalNode(tree, id) {
  const found = tree.nodes.filter(n => n['resource-id'] === id);
  return found.length === 1 ? found[0] : null;
}
async function readyTree(ctx) {
  let last;
  for (let attempt = 0; attempt < 8; attempt++) {
    let tree;
    try { tree = await hierarchy(ctx); }
    catch (e) {
      if (!['SESSION_CHANGED', 'UI_UNAVAILABLE'].includes(e.code)) throw e;
      last = e;
      await sleep(200);
      continue;
    }
    const title = optionalNode(tree, 'android:id/alertTitle');
    const message = optionalNode(tree, 'android:id/message');
    const cancel = optionalNode(tree, 'android:id/button2');
    const positive = optionalNode(tree, 'android:id/button1');
    if (title?.text === 'Access all files' && message?.text === ACCESS_MESSAGE && cancel?.text.toUpperCase() === 'CANCEL' && positive?.text.toUpperCase() === 'ACCESS ALL FILES') {
      await tap(ctx, cancel);
      await sleep(150);
      continue;
    }
    if (title) fail('UI_CHANGED', 'An unrecognized dialog covers the editor');
    const buffers = tree.nodes.filter(n => n['resource-id'] === TEXT && n.package === ctx.config.package);
    if (buffers.length === 1) return tree;
    last = new AppError('UI_CHANGED', 'The native editor buffer is unavailable', {}, 4);
    await sleep(200);
  }
  throw last || new AppError('UI_UNAVAILABLE', 'Editor did not become ready', {}, 3);
}
function modeAction(tree, name) {
  const idPattern = new RegExp('/(?:action_|menu_)?' + name + '$');
  const labelPattern = new RegExp('^' + name + '(?: mode)?$', 'i');
  const found = tree.nodes.filter(n => n.package === 'org.billthefarmer.editor' && n.clickable === 'true' && n.enabled === 'true' && (idPattern.test(n['resource-id']) || labelPattern.test(n.text.trim()) || labelPattern.test(n['content-desc'].trim())));
  if (found.length > 1) fail('UI_CHANGED', 'Mode action is ambiguous', { action: name });
  return found[0] || null;
}
function inspectTree(ctx, tree) {
  const buffer = nodeById(tree, TEXT);
  if (buffer.package !== ctx.config.package || buffer.password === 'true' || buffer.enabled !== 'true') fail('UI_CHANGED', 'Unexpected editor buffer');
  const edit = modeAction(tree, 'edit');
  const view = modeAction(tree, 'view');
  if (Boolean(edit) === Boolean(view)) fail('UI_CHANGED', 'Cannot identify the current native editor mode');
  const documentTitle = tree.nodes.filter(n => n.package === ctx.config.package && ['android:id/action_bar_title', 'org.billthefarmer.editor:id/action_bar_title'].includes(n['resource-id'])).map(n => ({ id: n['resource-id'], text: n.text })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    scopeKey: androidTargetKey({ APP2CLI_ANDROID_SERIAL: ctx.serial }) + ':' + ctx.config.component,
    data: { text: buffer.text, mode: edit ? 'view' : 'edit', documentTitle },
    proof: { transport: 'android-ui-hierarchy', hierarchySha256: tree.sha256, resourceId: TEXT, modeAction: (edit || view)['resource-id'], modeLabel: (edit || view)['content-desc'] || (edit || view).text }
  };
}
async function snapshot(ctx) { return inspectTree(ctx, await readyTree(ctx)); }
async function setMode(ctx, wanted) {
  const tree = await readyTree(ctx);
  const current = inspectTree(ctx, tree);
  if (current.data.mode === wanted) return current;
  const action = modeAction(tree, wanted === 'edit' ? 'edit' : 'view');
  if (!action) fail('UI_CHANGED', 'Required native mode action is missing');
  await tap(ctx, action);
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(200);
    const observed = await snapshot(ctx);
    if (observed.data.mode === wanted) return observed;
  }
  fail('VERIFICATION_FAILED', 'Native editor did not enter the requested mode', { mode: wanted }, 5);
}
function supported(text) { return typeof text === 'string' && text.length <= 8192 && /^[\x20-\x7e\n]*$/.test(text); }
async function typeText(ctx, text) {
  for (const part of text.split(/(\n|%)/)) {
    if (!part) continue;
    if (part === '\n') {
      await shell(ctx, ['input', 'keyevent', 'KEYCODE_ENTER']);
      continue;
    }
    for (let offset = 0; offset < part.length; offset += 128) {
      const chunk = part.slice(offset, offset + 128).replaceAll(' ', '%s');
      await shell(ctx, ['input', 'text', chunk]);
    }
  }
}

export default {
  targetKey(env) { return androidTargetKey(env); },
  async connect(env, config) {
    const ctx = await connectAndroid(env, config);
    await readyTree(ctx);
    return ctx;
  },
  async check(ctx, config) {
    await checkAndroid(ctx, config);
    const activities = await shell(ctx, ['dumpsys', 'activity', 'activities']);
    const resumed = activities.split('\n').filter(line => /topResumedActivity|mResumedActivity/.test(line));
    if (!resumed.some(line => /org\.billthefarmer\.editor\/(?:\.Editor|org\.billthefarmer\.editor\.Editor)(?:\s|\})/.test(line))) fail('SESSION_CHANGED', 'The expected Editor activity is not foreground');
    inspectTree(ctx, await readyTree(ctx));
  },
  async read(ctx) { return snapshot(ctx); },
  plan(command, input, before) {
    if (command !== 'buffer.replace') fail('UNKNOWN_COMMAND', 'Unknown mutation command', { command }, 2);
    if (!supported(input.text)) fail('INVALID_INPUT', 'Use at most 8192 printable ASCII characters and line feeds', {}, 2);
    if (!supported(before.data.text)) fail('INVALID_INPUT', 'The current buffer cannot be restored through the supported native input alphabet', {}, 2);
    return { scopeKey: before.scopeKey, before: before.data, expected: { ...before.data, text: input.text } };
  },
  async dispatch(ctx, command, input, plan) {
    if (command !== 'buffer.replace') fail('UNKNOWN_COMMAND', 'Unknown mutation command', { command }, 2);
    const latest = await snapshot(ctx);
    if (latest.scopeKey !== plan.scopeKey || canonical(latest.data) !== canonical(plan.before)) fail('STALE_STATE', 'The buffer or editor mode changed before dispatch');
    if (input.text === latest.data.text) return { operation: 'native-buffer-already-equal' };
    let changedMode = false;
    try {
      if (latest.data.mode !== 'edit') {
        changedMode = true;
        const editing = await setMode(ctx, 'edit');
        if (editing.data.text !== plan.before.text || canonical(editing.data.documentTitle) !== canonical(plan.before.documentTitle)) fail('SESSION_CHANGED', 'Mode transition changed the observed document');
      }
      const tree = await readyTree(ctx);
      const buffer = nodeById(tree, TEXT);
      await tap(ctx, buffer);
      const focused = nodeById(await readyTree(ctx), TEXT);
      if (focused.focused !== 'true') fail('UI_CHANGED', 'Native editor did not acquire input focus');
      await shell(ctx, ['input', 'keycombination', '113', '29']);
      await shell(ctx, ['input', 'keyevent', 'KEYCODE_DEL']);
      await typeText(ctx, input.text);
      const actual = await snapshot(ctx);
      if (actual.data.text !== input.text) fail('VERIFICATION_FAILED', 'Native text input did not produce the requested buffer', {}, 5);
      if (canonical(actual.data.documentTitle) !== canonical(plan.before.documentTitle)) fail('VERIFICATION_FAILED', 'The observed document title changed', {}, 5);
    } finally {
      if (changedMode) await setMode(ctx, plan.before.mode);
    }
    return { operation: 'native-select-all-and-replace', resourceId: TEXT };
  },
  matches(plan, observed) {
    return observed.scopeKey === plan.scopeKey && observed.data.text === plan.expected.text && observed.data.mode === plan.expected.mode && canonical(observed.data.documentTitle) === canonical(plan.expected.documentTitle);
  },
  async refresh(ctx) {
    const fresh = await hierarchy(ctx);
    inspectTree(ctx, fresh);
  },
  result(command, input, observed) {
    if (!['buffer.read', 'buffer.replace'].includes(command)) fail('UNKNOWN_COMMAND', 'Unknown command', { command }, 2);
    return { ...observed.data };
  },
  async close() {}
};