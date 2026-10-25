import {generateApplication} from './application.mjs';
import {generate as generateResource} from './resource.mjs';

export function generate(target,flags){
  const application=flags.scenario==='application'||target?.endsWith('.app')||(/^https?:\/\//.test(target||'')&&!flags.scenario&&!flags.capture&&!flags['api-case']&&(!flags.transport||['auto','browser-api'].includes(flags.transport))&&!flags['allow-ui-fallback']);
  return application?generateApplication(target,flags):generateResource(target,flags);
}
