import { AppError, sleep } from '../../lib/sdk.mjs';
import { androidTargetKey, connectAndroid, checkAndroid, hierarchy, shell } from '../../lib/android.mjs';
import { tapSelector, touchSelector, swipeSelector, inputText, nativeStateMatches, selectNodes } from '../../lib/android-ui.mjs';

const PACKAGE = 'com.ss.android.ugc.aweme.mobile';
const COMPONENT = PACKAGE + '/com.ss.android.ugc.aweme.splash.SplashActivity';
const APK = '46a3ebd3cf4b9a5020ebcea3aee02facaa80a7baae492b2c12090e5e0999baf0';
const id = name => PACKAGE + ':id/' + name;
const scoped = selector => ({ ...selector, package: PACKAGE });
const SEARCH_BUTTON = scoped({ 'content-desc': '搜索', clickable: 'true' });
const SIDEBAR_BUTTON = scoped({ 'content-desc': '侧边栏', clickable: 'true' });
const INPUT = scoped({ 'resource-id': id('et_search_kw'), class: 'android.widget.EditText' });
const SEARCH_BACK = scoped({ 'resource-id': id('amh'), 'content-desc': '返回', clickable: 'true' });
const SUBMIT = scoped({ 'resource-id': id('xc2'), text: '搜索', enabled: 'true' });
const COMMON = scoped({ 'resource-id': id('n9s'), text: '常用功能' });
const HOME_TAB = scoped({ 'resource-id': id('urj'), text: '首页' });
const CLOSE = scoped({ 'content-desc': '关闭，按钮', clickable: 'true' });
const LAYOUT_CONTROL = scoped({ 'resource-id': id('ump'), 'content-desc': '单双列切换图标' });
const LAYOUT = { ...LAYOUT_CONTROL, clickable: 'true' };
const COMPREHENSIVE = scoped({ 'resource-id': 'android:id/text1', text: '综合', class: 'android.widget.Button' });
const RESULT_LIST = scoped({ 'resource-id': id('lfp'), class: 'androidx.recyclerview.widget.RecyclerView', scrollable: 'true' });
const RESULT_CAPTION = scoped({ 'resource-id': id('desc'), class: 'android.widget.TextView' });
const VIDEO_VIEW = scoped({ 'resource-id': id('mgg'), class: 'android.view.View', clickable: 'true', enabled: 'true' });
const HOME = { kind: 'android-state', all: [HOME_TAB, SEARCH_BUTTON, SIDEBAR_BUTTON], none: [COMMON, INPUT, CLOSE] };
// lfp occurs on suggestions too; results chrome distinguishes submission.
const SEARCH = { kind: 'android-state', all: [INPUT, SEARCH_BACK, SUBMIT], none: [COMMON, LAYOUT_CONTROL, COMPREHENSIVE] };
const RESULTS_CHROME = { kind: 'android-state', all: [INPUT, SEARCH_BACK, LAYOUT, COMPREHENSIVE], none: [COMMON, CLOSE] };
const RESULTS = { kind: 'android-state', all: [...RESULTS_CHROME.all, RESULT_LIST, RESULT_CAPTION], none: RESULTS_CHROME.none };
const SIDEBAR = { kind: 'android-state', all: [COMMON, scoped({ 'resource-id': id('hfy'), text: '观看历史' }), CLOSE], none: [INPUT] };
const MUTATIONS = new Set(['home.open', 'search.open', 'search.input', 'search.submit', 'sidebar.open', 'sidebar.close', 'feed.next']);

function fail(message) { throw new AppError('UI_CHANGED', message, {}, 4); }
function pins(config) {
  if (config.package !== PACKAGE || config.component !== COMPONENT || config.apkSha256 !== APK || config.versionName !== '32.2.6') {
    throw new AppError('VERSION_DRIFT', 'Adapter package, component or release pin changed', {}, 4);
  }
}
function screenOf(tree) {
  if (nativeStateMatches(tree, SIDEBAR)) return 'sidebar';
  if (nativeStateMatches(tree, RESULTS_CHROME)) return 'results';
  if (nativeStateMatches(tree, SEARCH)) return 'search';
  if (nativeStateMatches(tree, HOME)) return 'home';
  return 'unknown';
}
async function observe(ctx) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return await hierarchy(ctx); }
    catch (error) {
      if (!['UI_UNAVAILABLE', 'SESSION_CHANGED'].includes(error.code)) throw error;
      last = error;
      if (attempt < 5) await sleep(250);
    }
  }
  throw last;
}
function stringsAt(tree, name) {
  return [...new Set(selectNodes(tree, scoped({ 'resource-id': id(name) })).filter(n => n.password !== 'true').map(n => n.text).filter(Boolean))];
}
function project(tree) {
  const screen = screenOf(tree);
  const fields = ['resource-id', 'text', 'content-desc', 'package', 'class', 'clickable', 'enabled', 'selected', 'checked', 'password', 'scrollable'];
  const nodes = tree.nodes.filter(n => n.package === PACKAGE && n.class !== 'android.widget.SeekBar' && n['resource-id'] !== id('ymp')).map(n => {
    const result = Object.fromEntries(fields.map(key => [key, n[key] || '']));
    if (n.password === 'true') { result.text = ''; result['content-desc'] = ''; }
    return result;
  });
  const inputs = selectNodes(tree, INPUT);
  return {
    screen,
    authentication: 'unconfirmed',
    query: ['search', 'results'].includes(screen) && inputs.length === 1 && inputs[0].password !== 'true' ? inputs[0].text : null,
    feed: screen === 'home' ? { authorLabels: stringsAt(tree, 'title'), captions: stringsAt(tree, 'desc'), declarations: stringsAt(tree, 'xao') } : null,
    results: screen === 'results' ? { captions: stringsAt(tree, 'desc'), authorLabels: stringsAt(tree, 'aca'), dates: stringsAt(tree, 'wbl'), scope: 'currently exposed native result text only' } : null,
    visibleText: [...new Set(nodes.filter(n => n.password !== 'true').map(n => n.text).filter(Boolean))],
    native: { nodes }
  };
}
async function waitState(ctx, witness) {
  const end = Date.now() + 25000;
  let tree;
  do {
    tree = await observe(ctx);
    if (nativeStateMatches(tree, witness)) return tree;
    await sleep(250);
  } while (Date.now() < end);
  const data = project(tree);
  throw new AppError('VERIFICATION_FAILED', 'Required native screen was not observed; inspect actual text for a service or login limitation', { witness, observedScreen: data.screen, observedText: data.visibleText }, 5);
}
function ensureQuery(query) {
  if (typeof query !== 'string' || query.length < 1 || query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query)) {
    throw new AppError('INVALID_INPUT', 'Provide 1-200 characters without control characters');
  }
}
function queryWitness(base, query) {
  return query === undefined ? base : { kind: 'android-state', all: [...base.all, { ...INPUT, text: query }], none: base.none };
}
async function returnHome(ctx) {
  let tree = await observe(ctx);
  for (let action = 0; action < 6; action++) {
    const current = screenOf(tree);
    if (current === 'home') return;
    if (current === 'search' || current === 'results') {
      // Back interception can leave another search state. Resolve afresh each time.
      await tapSelector(ctx, SEARCH_BACK);
    } else if (current === 'sidebar') {
      await shell(ctx, ['input', 'keyevent', '4']);
    } else {
      throw new AppError('UI_CHANGED', 'Home navigation requires an observed home, search, results or sidebar screen; other pages or prompts require native user interaction', { observedText: project(tree).visibleText }, 4);
    }
    for (let poll = 0; poll < 3; poll++) {
      await sleep(350);
      tree = await observe(ctx);
      if (nativeStateMatches(tree, HOME)) return;
    }
    tree = await observe(ctx);
  }
  if (nativeStateMatches(tree, HOME)) return;
  throw new AppError('VERIFICATION_FAILED', 'Bounded navigation did not establish native home', { witness: HOME, observedScreen: screenOf(tree), observedText: project(tree).visibleText }, 5);
}
function feedIdentity(data) {
  const feed = data.feed;
  if (data.screen !== 'home' || !feed || feed.authorLabels.length !== 1 || feed.captions.length !== 1 || !feed.authorLabels[0].trim() || !feed.captions[0].trim() || selectNodes(data.native, VIDEO_VIEW).length !== 1) return null;
  return { author: feed.authorLabels[0], caption: feed.captions[0] };
}
function changedFeed(data, previous) {
  const next = feedIdentity(data);
  return !!next && !!previous && next.author !== previous.author && next.caption !== previous.caption;
}
function hasCaptions(data) {
  return !!data.results?.captions.some(text => text.trim());
}

export default {
  targetKey(env) { return androidTargetKey(env); },
  async connect(env, config) {
    pins(config);
    return connectAndroid(env, config);
  },
  async check(ctx, config) {
    pins(config);
    await checkAndroid(ctx, config);
  },
  async read(ctx) {
    const tree = await observe(ctx);
    return {
      scopeKey: 'android:' + ctx.serial + ':' + PACKAGE,
      data: project(tree),
      proof: { transport: 'native-ui-hierarchy', package: PACKAGE, apkSha256: APK, hierarchySha256: tree.sha256, limitation: 'Displayed native state only; authentication, backend identities and server persistence are unconfirmed' }
    };
  },
  plan(command, input, before) {
    if (!MUTATIONS.has(command)) throw new AppError('UNKNOWN_COMMAND', 'Unsupported mutation command');
    const screen = before.data.screen;
    if (!['home', 'search', 'results', 'sidebar'].includes(screen)) fail('Current screen is outside the observed mapping; native user interaction is required');
    if (command === 'search.input' || command === 'search.submit') {
      ensureQuery(input.query);
      if (screen !== 'search') fail('Open the search input page before entering or submitting a query');
    }
    if (command === 'search.open' && input.query !== undefined) ensureQuery(input.query);
    if (command === 'search.open' && !['home', 'search'].includes(screen)) fail('Return home before opening search');
    if (command.startsWith('sidebar.') && !['home', 'sidebar'].includes(screen)) fail('Return home before operating the sidebar');
    let target, witness, previousFeed;
    if (command === 'search.submit') {
      target = 'results'; witness = queryWitness(RESULTS, input.query);
    } else if (command === 'search.open' || command === 'search.input') {
      target = 'search'; witness = queryWitness(SEARCH, input.query);
    } else if (command === 'sidebar.open') {
      target = 'sidebar'; witness = SIDEBAR;
    } else {
      target = 'home'; witness = HOME;
    }
    if (command === 'feed.next') {
      previousFeed = feedIdentity(before.data);
      if (!previousFeed) fail('Feed advancement requires one observed native video view, one nonempty author and one nonempty caption on home');
    }
    return { command, from: screen, screen: target, witness, ...(input.query === undefined ? {} : { query: input.query }), ...(previousFeed ? { previousFeed } : {}), restorationScope: 'Navigation screen only; feed item, suggestions and search history are not restored' };
  },
  async dispatch(ctx, command, input, plan) {
    if (!MUTATIONS.has(command) || plan.command !== command) throw new AppError('UNKNOWN_COMMAND', 'Unsupported mutation command');
    const tree = await observe(ctx);
    const current = screenOf(tree);
    if (current !== plan.from) throw new AppError('STALE_STATE', 'Native screen changed after planning', {}, 4);
    if (command === 'home.open') {
      await returnHome(ctx);
    } else if (command === 'sidebar.close') {
      if (!['home', 'sidebar'].includes(current)) fail('Sidebar close requires home or sidebar');
      await returnHome(ctx);
    } else if (command === 'sidebar.open') {
      if (current === 'home') await tapSelector(ctx, SIDEBAR_BUTTON);
      else if (current !== 'sidebar') fail('Sidebar open requires home');
      await waitState(ctx, SIDEBAR);
    } else if (command === 'search.open') {
      if (current === 'home') await tapSelector(ctx, SEARCH_BUTTON);
      else if (current !== 'search') fail('Search open requires home');
      await waitState(ctx, SEARCH);
      if (input.query !== undefined) {
        ensureQuery(input.query);
        await inputText(ctx, INPUT, input.query);
      }
      await waitState(ctx, plan.witness);
    } else if (command === 'search.input') {
      if (current !== 'search') fail('Search input requires the observed input page');
      ensureQuery(input.query);
      await inputText(ctx, INPUT, input.query);
      await waitState(ctx, plan.witness);
    } else if (command === 'search.submit') {
      if (current !== 'search') fail('Search submission requires the observed input page');
      ensureQuery(input.query);
      await inputText(ctx, INPUT, input.query);
      await waitState(ctx, queryWitness(SEARCH, input.query));
      // Custom native touch handling exports clickable=false on xc2.
      await touchSelector(ctx, SUBMIT);
      const results = await waitState(ctx, plan.witness);
      const data = project(results);
      if (!hasCaptions(data)) {
        throw new AppError('VERIFICATION_FAILED', 'Results controls appeared without actual exposed result captions', { observedText: data.visibleText }, 5);
      }
    } else if (command === 'feed.next') {
      const fresh = feedIdentity(project(tree));
      if (!fresh || fresh.author !== plan.previousFeed.author || fresh.caption !== plan.previousFeed.caption) throw new AppError('STALE_STATE', 'Feed text changed after planning', {}, 4);
      await swipeSelector(ctx, VIDEO_VIEW, 'up');
      const end = Date.now() + 15000;
      let data;
      do {
        data = project(await observe(ctx));
        if (changedFeed(data, plan.previousFeed)) return { dispatched: true, mechanism: 'one-native-video-view-swipe', verificationBasis: 'different exposed author and caption; no backend video ID' };
        await sleep(300);
      } while (Date.now() < end);
      throw new AppError('VERIFICATION_FAILED', 'One feed swipe did not establish both a different native author and a different native caption', { observedScreen: data.screen, observedFeed: data.feed, observedText: data.visibleText }, 5);
    }
    return { dispatched: true, mechanism: 'observed-native-controls', submission: command === 'search.submit' };
  },
  matches(plan, snapshot) {
    const data = snapshot.data;
    if (data.screen !== plan.screen || !nativeStateMatches(data.native, plan.witness) || (plan.query !== undefined && data.query !== plan.query)) return false;
    if (plan.command === 'search.submit') return hasCaptions(data);
    if (plan.command === 'feed.next') return changedFeed(data, plan.previousFeed);
    return true;
  },
  async refresh(ctx) { await observe(ctx); },
  result(command, input, snapshot) {
    if (command === 'feed.read') {
      if (snapshot.data.screen !== 'home') fail('Public feed read requires home; screen.read remains available on the active page');
      return { screen: snapshot.data.screen, feed: snapshot.data.feed, authentication: snapshot.data.authentication };
    }
    if (command === 'search.results') {
      if (snapshot.data.screen !== 'results' || !nativeStateMatches(snapshot.data.native, RESULTS) || !hasCaptions(snapshot.data)) {
        throw new AppError('UI_CHANGED', 'No submitted results with exposed captions are currently observed', { observedScreen: snapshot.data.screen, observedText: snapshot.data.visibleText }, 4);
      }
      return { screen: snapshot.data.screen, query: snapshot.data.query, results: snapshot.data.results, visibleText: snapshot.data.visibleText, authentication: snapshot.data.authentication };
    }
    return snapshot.data;
  },
  async close() {}
};
