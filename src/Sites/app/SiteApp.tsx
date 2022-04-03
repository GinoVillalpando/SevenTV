import React from 'react';
import ReactDOM from 'react-dom';
import { asapScheduler, from, iif, Observable, of, scheduled, Subject, throwError } from 'rxjs';
import { catchError, map, mergeAll, switchMap, tap, toArray } from 'rxjs/operators';
import { SettingNode } from 'src/Content/Runtime/Settings';
import { API } from 'src/Global/API';
import { Badge } from 'src/Global/Badge';
import { PageScriptListener } from 'src/Global/Decorators';
import { EmoteStore } from 'src/Global/EmoteStore';
import { SettingValue } from 'src/Global/Util';
import { Logger } from 'src/Logger';
import { EmbeddedUI } from 'src/Sites/app/EmbeddedUI';
import { MainComponent } from 'src/Sites/app/MainComponent';
import { TabCompleteDetection } from 'src/Sites/app/Runtime/TabCompleteDetection';

export class SiteApp {
	api = new API();
	mainComponent: MainComponent | null = null;
	emoteStore = emoteStore;
	embeddedUI = new EmbeddedUI(this);
	badges = [] as Badge[];
	badgeMap = new Map<number, number[]>();
	currentChannel = '';
	tabCompleteDetector = new TabCompleteDetection(this);
	config = config;

	menuPickEmote = new Subject<EmoteStore.Emote>();

	constructor() {
		// Fetch Badges
		this.api.GetBadges().pipe(
			switchMap(badges => from(badges)),
			map((badge, i) => {
				this.badges[i] = badge;
				for (const u of badge.users) {
					let id: number | string = parseInt(u);
					if (isNaN(id)) {
						id = u;
					}

					if (this.badgeMap.has(id as number)) {
						this.badgeMap.set(id as number, [...this.badgeMap.get(id as number) as number[], i]);
					} else {
						this.badgeMap.set(id as number, [i]);
					}
				}
				return badge;
			}),
			toArray(),
			tap(badges => Logger.Get().info(`Loaded ${badges.length} badges`))
		).subscribe();
	}

	switchChannel(data: {
		channelID: string;
		platform?: 'twitch' | 'youtube';
		channelName?: string;
		as?: string;
	}): Observable<EmoteStore.EmoteSet> {
		if (data.channelID == '') {
			throw new Error('channelID cannot be empty');
		}

		this.emoteStore.disableSet(this.currentChannel);
		if (!!data.as) this.emoteStore.disableSet(data.as);
		this.mainComponent?.toggleEmoteMenu(undefined, false);

		const emoteGetter = [
			this.api.GetGlobalEmotes().pipe(catchError(_ => of([]))),
			this.api.GetFrankerFaceZGlobalEmotes().pipe(
				catchError(() => of([]))
			),
			this.api.GetBTTVGlobalEmotes().pipe(
				catchError(() => of([]))
			),
			this.api.GetChannelEmotes(data.channelID).pipe(catchError(_ => of([]))),
			this.api.GetFrankerFaceZChannelEmotes(data.channelID, data.platform).pipe(
				catchError(() => of([]))
			),
			this.api.GetBTTVChannelEmotes(data.channelID, data.platform).pipe(
				catchError(() => of([]))
			)
		];

		return scheduled(emoteGetter, asapScheduler).pipe(
			mergeAll(),
			toArray(),
			map(a => a.reduce((a, b) => a.concat(b as any))),
			switchMap(e => iif(() => e.length === 0,
				throwError(Error(`7TV failed to load (perhaps service is down?)`)),
				of(e)
			)),
			map(e => emoteStore.enableSet(data.channelID, e)),
			tap(_ => {
				this.eIndex = null;
				this.currentChannel = data.channelID;
			})
		);
	}

	createOverlay(container: HTMLElement, emoteMenuOffset = 0): void {		// Once the extension injected itself into Twitch
		const app = document.createElement('div');
		app.classList.add('seventv-overlay');
		app.style.position = 'absolute';
		app.id = 'seventv';

		this.mainComponent = ReactDOM.render(<MainComponent emoteStore={emoteStore} emoteMenuOffset={emoteMenuOffset} />, app) as unknown as MainComponent;
		this.mainComponent.app = this;
		container.appendChild(app);
	}

	public eIndex: {
		[x: string]: EmoteStore.Emote;
	} | null = null;
	getEmoteIndex() {
		if (!!this.eIndex) {
			return this.eIndex;
		}

		const emotes = this.getAllEmotes();
		return emotes.length > 0 ? this.eIndex = emotes.map(e => ({ [e.name]: e })).reduce((a, b) => ({ ...a, ...b })) : {};
	}

	getAllEmotes(): EmoteStore.Emote[] {
		const emotes = [] as EmoteStore.Emote[];
		for (const set of emoteStore.sets.values()) {
			emotes.push(...set.getEmotes().sort((a, b) => a.weight - b.weight));
		}

		return emotes;
	}

	chatResize(): any {
		const BORDER_SIZE = 4;
		let rightBeside: any = document.getElementsByClassName('right-column--beside')[0];
		let chatCol: any = document.getElementsByClassName('channel-root__right-column')[0];
		let resizeDiv: any = document.createElement('div'); // TODO: finish creating div for resizing chat

		resizeDiv.setAttribute('class', 'resize-div');

		let m_pos: any;

		function resize(event: any) {
			const dx = m_pos - event.x;
			m_pos = event.x;

			if (rightBeside.style.width) {
				const widthNum = parseInt(rightBeside.style.width) + dx;
				
				if (widthNum >= 4) {
					rightBeside.style.width = (widthNum < 4 ? 4 : widthNum) + 'px';
				}
			} else {
				rightBeside.style.width = (parseInt(getComputedStyle(rightBeside, '').width) + dx) + 'px';
			}

			if (chatCol.style.width) {
				const widthNum = parseInt(chatCol.style.width) + dx;

				if (widthNum >= 340) {
					chatCol.style.width = (widthNum < 340 ? 340 : widthNum) + 'px';
				}

			} else {
				chatCol.style.width = (parseInt(getComputedStyle(chatCol, '').width) + dx) + 'px';
			}
		}

		rightBeside.addEventListener("mousedown", (event: any) => {
			if (event.offsetX < BORDER_SIZE) {
				m_pos = event.x;
				document.addEventListener("mousemove", resize, false);
			}
		}, false);

		document.addEventListener("mouseup", () => {
			document.removeEventListener("mousemove", resize, false);
		}, false);
	}


	@PageScriptListener('OnAssets')
	onExtensionAssets(assetMap: [string, string][]) {
		assetStore = new Map(assetMap);
	}

	@PageScriptListener('ConfigNodes')
	whenConfigNodes(nodes: SettingNode[]): void {
		settingNodes = nodes;
	}

	@PageScriptListener('ConfigChange')
	whenAppConfigChangeds(cfg: { [x: string]: any; }): void {
		for (const k of Object.keys(cfg)) {
			config.set(k, new SettingValue(cfg[k]));
		}
	}

	/**
	 * Send a message to the content script layer
	 *
	 * @param tag the event tag
	 * @param data the event data
	 */
	sendMessageUp(tag: string, data: any): void {
		window.dispatchEvent(new CustomEvent(`7TV#${tag}`, { detail: JSON.stringify(data) }));
	}
}

export const emoteStore = new EmoteStore();
export let assetStore = new Map<string, string>();
export let settingNodes = [] as SettingNode[];
const config = new Map<string, SettingValue>();
export const configMap = config;

