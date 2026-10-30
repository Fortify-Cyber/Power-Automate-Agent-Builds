import { SPHttpClient, type SPHttpClientResponse } from '@microsoft/sp-http';

// List items as the hub's lists store them (an empty link field comes back as null).
// Deploy-CassinAIHub.ps1; keep the two in step.
export interface ILink { Url: string; Description: string }

export interface IPrompt {
  Id: number; Title: string; PromptText: string; Category: string; Practice: string;
  WorksIn: string[]; HowToUse: string; WatchOuts: string; Featured: boolean;
}
export interface ITip {
  Id: number; Title: string; TipNumber: number; TipDate: string; WorksWith: string;
  WhyItHelps: string; Steps: string; TipPrompt: string; VideoLink?: ILink; ArticleLink?: ILink;
}
export interface IVideo {
  Id: number; Title: string; VideoLink?: ILink; App: string; SkillLevel: string;
  VideoSource: string; VideoDescription: string;
}
export interface IAgent {
  Id: number; Title: string; AgentStatus: string; WhatItDoes: string; HowToStart: string; Champion: string;
}
export interface IFaq { Id: number; Title: string; Answer: string; Topic: string }
export interface IFeedback {
  Id: number; Title: string; FeedbackType: string; About: string; FeedbackStatus: string;
  Response: string; Created: string;
}

export const LISTS = {
  prompts: 'Lists/PromptLibrary',
  tips: 'Lists/FridayTips',
  videos: 'Lists/DemoVideos',
  agents: 'Lists/AIAgents',
  faq: 'Lists/AIFAQ',
  feedback: 'Lists/HubFeedback'
} as const;

export class ListNotFoundError extends Error {}

export class HubData {
  public constructor(private readonly _http: SPHttpClient, private readonly _webUrl: string,
                     private readonly _webRelUrl: string) {}

  public listUrl(list: string): string {
    return `${this._webUrl}/${list}`;
  }

  public prompts(): Promise<IPrompt[]> {
    // Only approved prompts: owners would otherwise also see pending submissions.
    return this._items<IPrompt>(LISTS.prompts,
      'Id,Title,PromptText,Category,Practice,WorksIn,HowToUse,WatchOuts,Featured',
      'OData__ModerationStatus eq 0', 'Title')
      .then(rows => rows.map(r => ({ ...r, WorksIn: asArray(r.WorksIn) })));
  }

  public tips(): Promise<ITip[]> {
    return this._items<ITip>(LISTS.tips,
      'Id,Title,TipNumber,TipDate,WorksWith,WhyItHelps,Steps,TipPrompt,VideoLink,ArticleLink',
      '', 'TipDate desc');
  }

  public videos(): Promise<IVideo[]> {
    return this._items<IVideo>(LISTS.videos,
      'Id,Title,VideoLink,App,SkillLevel,VideoSource,VideoDescription', '', 'Title');
  }

  public agents(): Promise<IAgent[]> {
    return this._items<IAgent>(LISTS.agents,
      'Id,Title,AgentStatus,WhatItDoes,HowToStart,Champion', "AgentStatus ne 'Retired'", 'Id');
  }

  public faq(): Promise<IFaq[]> {
    return this._items<IFaq>(LISTS.faq, 'Id,Title,Answer,Topic', '', 'Id');
  }

  public myFeedback(userId: number): Promise<IFeedback[]> {
    return this._items<IFeedback>(LISTS.feedback,
      'Id,Title,FeedbackType,About,FeedbackStatus,Response,Created', `AuthorId eq ${userId}`, 'Created desc');
  }

  private _items<T>(list: string, select: string, filter: string, orderBy: string): Promise<T[]> {
    const path = `${this._webRelUrl.replace(/\/$/, '')}/${list}`.replace(/'/g, "''");
    let url = `${this._webUrl}/_api/web/GetList('${encodeURIComponent(path)}')/items?$select=${select}&$top=500&$orderby=${orderBy}`;
    if (filter) url += `&$filter=${encodeURIComponent(filter)}`;
    return this._http.get(url, SPHttpClient.configurations.v1, { headers: { Accept: 'application/json;odata=nometadata' } })
      .then((res: SPHttpClientResponse) => {
        if (res.status === 404) throw new ListNotFoundError(list);
        if (!res.ok) throw new Error(`${list}: HTTP ${res.status}`);
        return res.json();
      })
      .then((body: { value: T[] }) => body.value);
  }
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (v && typeof v === 'object' && Array.isArray((v as { results?: string[] }).results)) {
    return (v as { results: string[] }).results;
  }
  return typeof v === 'string' && v ? v.split(';#').filter(Boolean) : [];
}
