import { Version } from '@microsoft/sp-core-library';
import {
  type IPropertyPaneConfiguration,
  PropertyPaneDropdown,
  PropertyPaneSlider
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import { SPPermission } from '@microsoft/sp-page-context';

import { HubData, LISTS, ListNotFoundError, type IPrompt } from './data';
import { AdoptionData, AdoptionError, HISTORY_LIST } from './adoptionData';
import { AdoptionView } from './adoptionView';
import * as R from './render';
import { ensureStyles } from './styles';

/**
 * One web part for every list-driven section of the Cassin AI Hub. The Section property
 * picks what it shows; Deploy-CassinAIHub.ps1 places one per section with that property
 * set. All content is read live from the hub's lists, so adding a tip, prompt, video,
 * agent or FAQ in SharePoint shows up here with no code change.
 *
 * The "adoption" section is the admin-only Copilot adoption page. It reads Microsoft's
 * Copilot usage reports and Entra ID through Microsoft Graph as the signed-in admin
 * (adoptionData.ts); the page itself is restricted to owners and AI Hub Admins by the
 * deploy script.
 */
export type Section = 'latestTip' | 'featuredPrompts' | 'promptLibrary' | 'fridayTips' |
  'videos' | 'agents' | 'faq' | 'myFeedback' | 'adoption';

export interface ICassinAiHubWebPartProps {
  section: Section;
  maxItems: number;
}

const SECTIONS: Array<{ key: Section; text: string; list: string }> = [
  { key: 'latestTip', text: "This week's Friday tip", list: LISTS.tips },
  { key: 'featuredPrompts', text: 'Featured prompts', list: LISTS.prompts },
  { key: 'promptLibrary', text: 'Prompt Library (search and filters)', list: LISTS.prompts },
  { key: 'fridayTips', text: 'All Friday tips', list: LISTS.tips },
  { key: 'videos', text: 'Demo videos', list: LISTS.videos },
  { key: 'agents', text: 'Agents & tools', list: LISTS.agents },
  { key: 'faq', text: 'FAQ', list: LISTS.faq },
  { key: 'myFeedback', text: 'My feedback', list: LISTS.feedback },
  { key: 'adoption', text: 'Copilot adoption (admins only)', list: HISTORY_LIST }
];

const ADOPTION_PAGE = 'Copilot-Adoption';

export default class CassinAiHubWebPart extends BaseClientSideWebPart<ICassinAiHubWebPartProps> {
  private _data!: HubData;
  private _prompts: IPrompt[] = [];
  private _filter: R.IPromptFilter = { q: '', cat: 'All' };
  private _toastTimer: number | undefined;
  private _adoption: AdoptionView | undefined;

  protected onInit(): Promise<void> {
    ensureStyles();
    const web = this.context.pageContext.web;
    this._data = new HubData(this.context.spHttpClient, web.absoluteUrl, web.serverRelativeUrl);
    this.domElement.addEventListener('click', e => this._onClick(e));
    this.domElement.addEventListener('input', e => this._onInput(e));
    this.domElement.addEventListener('change', e => this._onInput(e));
    this.domElement.addEventListener('keydown', e => this._adoption?.onKey(e));
    return Promise.resolve();
  }

  public render(): void {
    this.domElement.innerHTML = '<div class="cah"><div class="loading">Loading…</div></div>';
    this._adoption?.dispose();
    this._adoption = undefined;
    this._load()
      .then(html => {
        this.domElement.innerHTML = `<div class="cah">${html}${this._manageLink()}</div>`;
        const root = this.domElement.querySelector<HTMLElement>('.cah');
        if (this._adoption && root) this._adoption.mount(root);
        if (this.properties.section === 'latestTip' && root) this._addAdminLink(root);
      })
      .catch(err => {
        const section = SECTIONS.find(s => s.key === this.properties.section);
        const msg = err instanceof AdoptionError ? this._adoptionMessage(err)
          : err instanceof ListNotFoundError
          ? `Couldn't find the ${section?.list.replace('Lists/', '')} list on this site. This web part only works on the Cassin AI Hub site.`
          : "Couldn't load this section. Refresh the page; if it keeps happening, tell the AI Working Group.";
        this.domElement.innerHTML = `<div class="cah">${R.empty(msg)}</div>`;
        console.error('Cassin AI Hub web part', err);
      });
  }

  private _load(): Promise<string> {
    const web = this.context.pageContext.web.absoluteUrl;
    const page = (name: string): string => `${web}/SitePages/${name}.aspx`;
    switch (this.properties.section) {
      case 'latestTip':
        return this._data.tips().then(t => R.latestTip(t, page('Friday-Tips')));
      case 'featuredPrompts':
        return this._data.prompts().then(p => R.featuredPrompts(p, page('Prompt-Library'), this.properties.maxItems || 6));
      case 'promptLibrary':
        return this._data.prompts().then(p => { this._prompts = p; return R.promptLibraryShell(p, this._filter); });
      case 'fridayTips':
        return this._data.tips().then(R.allTips);
      case 'videos':
        return this._data.videos().then(R.videos);
      case 'agents':
        return this._data.agents().then(R.agents);
      case 'faq':
        return this._data.faq().then(R.faq);
      case 'myFeedback':
        return this._data.myFeedback(Number(this.context.pageContext.legacyPageContext.userId)).then(R.myFeedback);
      case 'adoption': {
        const web = this.context.pageContext.web;
        return new AdoptionData(this.context.msGraphClientFactory, this.context.spHttpClient, web.absoluteUrl, web.serverRelativeUrl)
          .load().then(({ model, saved }) => {
            this._adoption = new AdoptionView(model, saved);
            return this._adoption.html();
          });
      }
      default:
        return Promise.resolve(R.empty('Pick a section in this web part’s settings.'));
    }
  }

  // Site owners get a link to the underlying list, where content is added and edited.
  private _manageLink(): string {
    const section = SECTIONS.find(s => s.key === this.properties.section);
    if (!section || section.key === 'adoption' || !this.context.pageContext.web.permissions.hasPermission(SPPermission.manageLists)) return '';
    return `<p class="manage"><a href="${R.esc(this._data.listUrl(section.list))}">Owners: add or edit items in the list →</a></p>`;
  }

  // People who can open the admin-only history list (owners and AI Hub Admins) get a link to
  // the adoption page on the home page; everyone else sees nothing.
  private _addAdminLink(root: HTMLElement): void {
    this._data.canRead(HISTORY_LIST).then(ok => {
      if (!ok || root.querySelector('.admin-link')) return;
      const url = `${this.context.pageContext.web.absoluteUrl}/SitePages/${ADOPTION_PAGE}.aspx`;
      root.insertAdjacentHTML('beforeend', `<p class="manage admin-link"><a href="${R.esc(url)}">Admins: Copilot adoption →</a></p>`);
    }).catch(() => undefined);
  }

  private _adoptionMessage(err: AdoptionError): string {
    console.error('Cassin AI Hub adoption', err.message);
    if (err.kind === 'consent') {
      return "This page can't read Microsoft's Copilot reports yet. A SharePoint admin needs to approve the web part's Microsoft Graph access: SharePoint admin center → Advanced → API access, then approve Reports.Read.All and User.Read.All for Cassin AI Hub web part.";
    }
    if (err.kind === 'role') {
      return "Microsoft only shows Copilot usage reports to people with a reports role. Ask an IT admin to give your account the Reports Reader role in Microsoft Entra ID (it can take an hour to apply), then reload this page.";
    }
    return "Couldn't load Microsoft's Copilot usage reports. Refresh the page; if it keeps happening, tell Fortify Cyber.";
  }

  protected onDispose(): void {
    this._adoption?.dispose();
    super.onDispose();
  }

  private _onClick(e: Event): void {
    if (this._adoption?.onClick(e)) return;
    const target = e.target as HTMLElement;
    const copy = target.closest<HTMLElement>('[data-copy]');
    if (copy) { this._copy(copy.getAttribute('data-copy') || ''); return; }
    const cat = target.closest<HTMLElement>('[data-cat]');
    if (cat) {
      this._filter.cat = cat.getAttribute('data-cat') || 'All';
      this.domElement.querySelectorAll<HTMLElement>('[data-cat]').forEach(b => {
        const on = b === cat;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      this._redrawResults();
    }
  }

  private _onInput(e: Event): void {
    if (this._adoption?.onInput(e)) return;
    const input = e.target as HTMLInputElement;
    if (!input.hasAttribute('data-search')) return;
    this._filter.q = input.value;
    this._redrawResults();
  }

  private _redrawResults(): void {
    const results = this.domElement.querySelector('[data-results]');
    if (results) results.innerHTML = R.promptResults(this._prompts, this._filter);
  }

  private _copy(text: string): void {
    const done = (): void => this._toast('Prompt copied. Paste it into Copilot.');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => this._copyFallback(text, done));
    } else {
      this._copyFallback(text, done);
    }
  }

  private _copyFallback(text: string, done: () => void): void {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      // execCommand is deprecated but still the only fallback where the Clipboard API is blocked.
      if (document.execCommand('copy')) done(); else this._toast('Select the prompt text and copy it.');
    } finally {
      document.body.removeChild(area);
    }
  }

  private _toast(msg: string): void {
    let el = this.domElement.querySelector<HTMLElement>('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      this.domElement.querySelector('.cah')?.appendChild(el);
    }
    el.textContent = msg;
    window.clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => el?.remove(), 2800);
  }

  protected get disableReactivePropertyChanges(): boolean {
    return false;
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [{
        header: { description: 'Shows one section of the Cassin AI Hub, read live from the hub’s lists.' },
        groups: [{
          groupName: 'Section',
          groupFields: [
            PropertyPaneDropdown('section', {
              label: 'What to show',
              options: SECTIONS.map(s => ({ key: s.key, text: s.text }))
            }),
            PropertyPaneSlider('maxItems', { label: 'Featured prompts to show', min: 3, max: 12, step: 3 })
          ]
        }]
      }]
    };
  }
}
