import { browserTargetKey, connectBrowser, checkBrowser } from '../../lib/web.mjs';
import { AppError, canonical } from '../../lib/sdk.mjs';

async function acquire(ctx) {
  if (ctx.store) { await ctx.store.dispose().catch(() => {}); ctx.store = null; }
  ctx.store = await ctx.page.evaluateHandle(() => {
    const chunks = globalThis.webpackChunk_N_E;
    if (!Array.isArray(chunks) || typeof chunks.push !== 'function') throw new Error('Webpack runtime unavailable');
    let require;
    chunks.push([['app2cli_dillinger_' + crypto.randomUUID()], {}, runtime => { require = runtime; }]);
    if (typeof require !== 'function' || typeof require.m?.[92167] !== 'function') throw new Error('Native document module unavailable');
    const store = require(92167).o;
    if (typeof store !== 'function' || typeof store.getState !== 'function' || typeof store.subscribe !== 'function') throw new Error('Native document store interface changed');
    const state = store.getState();
    for (const name of ['updateDocumentBody', 'persist', 'hydrate']) {
      if (typeof state[name] !== 'function') throw new Error('Missing native method: ' + name);
    }
    if (!Array.isArray(state.documents) || !state.settings || typeof state.settings !== 'object') throw new Error('Native document state shape changed');
    return store;
  });
  await ctx.page.waitForFunction(store => {
    const s = store.getState();
    const d = s.currentDocument;
    return Boolean(d && typeof d.id === 'string' && typeof d.title === 'string' && typeof d.body === 'string' && Array.isArray(s.documents) && s.documents.filter(x => x.id === d.id).length === 1 && typeof s.editorInstance?.getValue === 'function' && s.editorInstance.getValue() === d.body);
  }, ctx.store, { timeout: 20000 });
}

async function snapshot(ctx) {
  const observed = await ctx.page.evaluate(store => {
    const s = store.getState();
    const d = s.currentDocument;
    if (!d || typeof d.body !== 'string') throw new Error('No current Markdown document');
    const previews = document.querySelectorAll('#preview');
    const preview = previews.length === 1 ? previews[0] : null;
    return {
      data: { body: d.body, currentDocument: d, documents: s.documents, settings: s.settings },
      proof: {
        transport: 'webpack-native-store', module: 92167, export: 'o',
        editorBody: typeof s.editorInstance?.getValue === 'function' ? s.editorInstance.getValue() : null,
        previewCount: previews.length,
        previewText: preview ? preview.innerText : null,
        previewHtml: preview ? preview.innerHTML : null,
        isDirty: s.isDirty
      }
    };
  }, ctx.store);
  return { scopeKey: ctx.origin + '|target:' + ctx.targetId, ...observed };
}

export default {
  targetKey(env, config) { return browserTargetKey(env); },
  async connect(env, config) { return connectBrowser(env, config); },
  async check(ctx, config) {
    await checkBrowser(ctx, config);
    try { await acquire(ctx); }
    catch (error) { throw new AppError('VERSION_DRIFT', 'Required native document interface is unavailable', { cause: error.message }, 4); }
  },
  async read(ctx) { return snapshot(ctx); },
  plan(command, input, before) {
    if (command !== 'document.replace') throw new AppError('UNKNOWN_COMMAND', 'Unsupported mutation', { command });
    if (typeof input.body !== 'string' || input.body.length > 1000000) throw new AppError('INVALID_INPUT', 'body must be a string of at most 1000000 characters');
    const d = before.data.currentDocument;
    if (!d || before.data.documents.filter(x => x.id === d.id).length !== 1) throw new AppError('STALE_STATE', 'Current document is ambiguous', {}, 4);
    const expected = {
      body: input.body,
      currentDocument: { ...d, body: input.body },
      documents: before.data.documents.map(x => x.id === d.id ? { ...x, body: input.body } : x),
      settings: before.data.settings
    };
    return {
      scopeKey: before.scopeKey,
      before: before.data,
      expected,
      expectedPreviewText: /^[A-Za-z0-9_]+$/.test(input.body) ? input.body : null
    };
  },
  async dispatch(ctx, command, input, plan) {
    if (command !== 'document.replace') throw new AppError('UNKNOWN_COMMAND', 'Unsupported mutation', { command });
    const now = await snapshot(ctx);
    if (now.scopeKey !== plan.scopeKey || canonical(now.data) !== canonical(plan.before)) throw new AppError('STALE_STATE', 'Document state changed before dispatch', {}, 4);
    const outcome = await ctx.page.evaluate(({ store, before, body }) => {
      const s = store.getState();
      const actual = { body: s.currentDocument?.body, currentDocument: s.currentDocument, documents: s.documents, settings: s.settings };
      const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])) : value;
      if (JSON.stringify(sort(actual)) !== JSON.stringify(sort(before))) return { stale: true };
      s.updateDocumentBody(body);
      store.getState().persist();
      return { dispatched: true };
    }, { store: ctx.store, before: plan.before, body: input.body });
    if (outcome.stale) throw new AppError('STALE_STATE', 'Document state changed before native replacement', {}, 4);
    return outcome;
  },
  matches(plan, observed) {
    if (observed.scopeKey !== plan.scopeKey || canonical(observed.data) !== canonical(plan.expected)) return false;
    const p = observed.proof;
    if (p.editorBody !== plan.expected.body || p.previewCount !== 1 || p.isDirty !== false) return false;
    if (plan.expectedPreviewText !== null) return typeof p.previewText === 'string' && p.previewText.trim() === plan.expectedPreviewText;
    return typeof p.previewHtml === 'string' && (plan.expected.body.length === 0 || p.previewHtml.length > 0);
  },
  async refresh(ctx) {
    if (ctx.store) { await ctx.store.dispose().catch(() => {}); ctx.store = null; }
    await ctx.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  },
  result(command, input, observed) {
    if (!['document.read', 'document.replace'].includes(command)) throw new AppError('UNKNOWN_COMMAND', 'Unsupported command', { command });
    return { body: observed.data.body, document: observed.data.currentDocument };
  },
  async close(ctx) {
    try { if (ctx.store) await ctx.store.dispose().catch(() => {}); }
    finally { await ctx.browser.close(); }
  }
};
