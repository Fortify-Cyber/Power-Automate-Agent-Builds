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
  /** Rough timing for "Coming next", e.g. "Late November". */
  Expected?: string;
}
export interface IFaq { Id: number; Title: string; Answer: string; Topic: string }
export interface IFeedback {
  Id: number; Title: string; FeedbackType: string; About: string; FeedbackStatus: string;
  Response: string; Created: string;
}

// The working group's lists (Program status page). Readable by site owners and members only.
export interface IRoadmapItem {
  Id: number; Title: string; RoadmapStage: string; Track: string; ItemType: string[]; HomeArea: string[];
  Confidence: string; TimeSaved: string; TargetWindow: string; Champion: string; NextUp: string; RoadmapNotes: string;
  DemoVideo?: ILink; PublishedLink?: ILink;
  /** The name this item goes by in the Feedback form's "About" choice, when it differs from Title. */
  FeedbackAs: string;
}
export interface IWaiting {
  Id: number; Title: string; WaitingStatus: string; WaitingNotes: string; DueDate: string | null;
  WaitingOwner?: { Title: string } | null; RoadmapItems?: Array<{ Title: string }>;
}
export interface IFeedbackItem extends IFeedback {
  Details: string; Rating: string; DoneOn: string | null; Author?: { Title: string };
}

export const LISTS = {
  prompts: 'Lists/PromptLibrary',
  tips: 'Lists/FridayTips',
  videos: 'Lists/DemoVideos',
  agents: 'Lists/AIAgents',
  faq: 'Lists/AIFAQ',
  feedback: 'Lists/HubFeedback',
  roadmap: 'Lists/AIRoadmap',
  waiting: 'Lists/WaitingOnCassin'
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
    const read = (extra: string): Promise<IAgent[]> => this._items<IAgent>(LISTS.agents,
      `Id,Title,AgentStatus,WhatItDoes,HowToStart,Champion${extra}`, "AgentStatus ne 'Retired'", 'Id');
    // "Expected" arrives with the deploy script's next run; until then, read without it.
    return read(',Expected').catch(err => (/HTTP 400/.test(String(err)) ? read('') : Promise.reject(err)));
  }

  public roadmap(): Promise<IRoadmapItem[]> {
    return this._items<IRoadmapItem>(LISTS.roadmap,
      'Id,Title,RoadmapStage,Track,ItemType,HomeArea,Confidence,TimeSaved,TargetWindow,Champion,NextUp,RoadmapNotes,DemoVideo,PublishedLink,FeedbackAs',
      '', 'Title').then(rows => rows.map(r => ({ ...r, ItemType: asArray(r.ItemType), HomeArea: asArray(r.HomeArea) })));
  }

  public waiting(): Promise<IWaiting[]> {
    return this._items<IWaiting>(LISTS.waiting,
      'Id,Title,WaitingStatus,WaitingNotes,DueDate,WaitingOwner/Title,RoadmapItems/Title', '', 'Id', 'WaitingOwner,RoadmapItems');
  }

  /** Every feedback item; only people who can manage the list (owners, members) get them all. */
  public allFeedback(): Promise<IFeedbackItem[]> {
    return this._items<IFeedbackItem>(LISTS.feedback,
      'Id,Title,FeedbackType,About,Details,Rating,FeedbackStatus,Response,DoneOn,Created,Author/Title', '', 'Created desc', 'Author');
  }

  public faq(): Promise<IFaq[]> {
    return this._items<IFaq>(LISTS.faq, 'Id,Title,Answer,Topic', '', 'Id');
  }

  public myFeedback(userId: number): Promise<IFeedback[]> {
    return this._items<IFeedback>(LISTS.feedback,
      'Id,Title,FeedbackType,About,FeedbackStatus,Response,Created', `AuthorId eq ${userId}`, 'Created desc');
  }

  /** True when the signed-in person can open the list (used to show admin-only links). */
  public canRead(list: string): Promise<boolean> {
    const path = `${this._webRelUrl.replace(/\/$/, '')}/${list}`.replace(/'/g, "''");
    return this._http.get(`${this._webUrl}/_api/web/GetList('${encodeURIComponent(path)}')?$select=Id`, SPHttpClient.configurations.v1,
      { headers: { Accept: 'application/json;odata=nometadata' } }).then(res => res.ok);
  }

  private _items<T>(list: string, select: string, filter: string, orderBy: string, expand = ''): Promise<T[]> {
    const path = `${this._webRelUrl.replace(/\/$/, '')}/${list}`.replace(/'/g, "''");
    let url = `${this._webUrl}/_api/web/GetList('${encodeURIComponent(path)}')/items?$select=${select}&$top=500&$orderby=${orderBy}`;
    if (filter) url += `&$filter=${encodeURIComponent(filter)}`;
    if (expand) url += `&$expand=${expand}`;
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
