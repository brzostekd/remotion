/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ChildProcess} from 'child_process';
import {Protocol} from 'devtools-protocol';
import {assert} from './assert';
import {Connection, ConnectionEmittedEvents} from './Connection';
import {EventEmitter} from './EventEmitter';
import {Page} from './Page';
import {Viewport} from './PuppeteerViewport';
import {Target} from './Target';
import {TaskQueue} from './TaskQueue';
import {waitWithTimeout} from './util';

/**
 * BrowserContext options.
 *
 * @public
 */
export interface BrowserContextOptions {
	/**
	 * Proxy server with optional port to use for all requests.
	 * Username and password can be set in `Page.authenticate`.
	 */
	proxyServer?: string;
	/**
	 * Bypass the proxy for the given semi-colon-separated list of hosts.
	 */
	proxyBypassList?: string[];
}

/**
 * @internal
 */
export type BrowserCloseCallback = () => Promise<void> | void;

/**
 * @public
 */
export type TargetFilterCallback = (
	target: Protocol.Target.TargetInfo
) => boolean;

/**
 * @internal
 */
export type IsPageTargetCallback = (
	target: Protocol.Target.TargetInfo
) => boolean;

const WEB_PERMISSION_TO_PROTOCOL_PERMISSION = new Map<
	Permission,
	Protocol.Browser.PermissionType
>([
	['geolocation', 'geolocation'],
	['midi', 'midi'],
	['notifications', 'notifications'],
	// TODO: push isn't a valid type?
	// ['push', 'push'],
	['camera', 'videoCapture'],
	['microphone', 'audioCapture'],
	['background-sync', 'backgroundSync'],
	['ambient-light-sensor', 'sensors'],
	['accelerometer', 'sensors'],
	['gyroscope', 'sensors'],
	['magnetometer', 'sensors'],
	['accessibility-events', 'accessibilityEvents'],
	['clipboard-read', 'clipboardReadWrite'],
	['clipboard-write', 'clipboardReadWrite'],
	['payment-handler', 'paymentHandler'],
	['persistent-storage', 'durableStorage'],
	['idle-detection', 'idleDetection'],
	// chrome-specific permissions we have.
	['midi-sysex', 'midiSysex'],
]);

/**
 * @public
 */
export type Permission =
	| 'geolocation'
	| 'midi'
	| 'notifications'
	| 'camera'
	| 'microphone'
	| 'background-sync'
	| 'ambient-light-sensor'
	| 'accelerometer'
	| 'gyroscope'
	| 'magnetometer'
	| 'accessibility-events'
	| 'clipboard-read'
	| 'clipboard-write'
	| 'payment-handler'
	| 'persistent-storage'
	| 'idle-detection'
	| 'midi-sysex';

/**
 * @public
 */
export interface WaitForTargetOptions {
	/**
	 * Maximum wait time in milliseconds. Pass `0` to disable the timeout.
	 * @defaultValue 30 seconds.
	 */
	timeout?: number;
}

/**
 * All the events a {@link Browser | browser instance} may emit.
 *
 * @public
 */
export const enum BrowserEmittedEvents {
	/**
	 * Emitted when Puppeteer gets disconnected from the Chromium instance. This
	 * might happen because of one of the following:
	 *
	 * - Chromium is closed or crashed
	 *
	 * - The {@link Browser.disconnect | browser.disconnect } method was called.
	 */
	Disconnected = 'disconnected',

	/**
	 * Emitted when the url of a target changes. Contains a {@link Target} instance.
	 *
	 * @remarks
	 *
	 * Note that this includes target changes in incognito browser contexts.
	 */
	TargetChanged = 'targetchanged',

	/**
	 * Emitted when a target is created, for example when a new page is opened by
	 * {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/open | window.open}
	 * or by {@link Browser.newPage | browser.newPage}
	 *
	 * Contains a {@link Target} instance.
	 *
	 * @remarks
	 *
	 * Note that this includes target creations in incognito browser contexts.
	 */
	TargetCreated = 'targetcreated',
	/**
	 * Emitted when a target is destroyed, for example when a page is closed.
	 * Contains a {@link Target} instance.
	 *
	 * @remarks
	 *
	 * Note that this includes target destructions in incognito browser contexts.
	 */
	TargetDestroyed = 'targetdestroyed',
}

/**
 * A Browser is created when Puppeteer connects to a Chromium instance, either through
 * {@link PuppeteerNode.launch} or {@link Puppeteer.connect}.
 *
 * @remarks
 *
 * The Browser class extends from Puppeteer's {@link EventEmitter} class and will
 * emit various events which are documented in the {@link BrowserEmittedEvents} enum.
 *
 * @example
 *
 * An example of using a {@link Browser} to create a {@link Page}:
 * ```js
 * const puppeteer = require('puppeteer');
 *
 * (async () => {
 *   const browser = await puppeteer.launch();
 *   const page = await browser.newPage();
 *   await page.goto('https://example.com');
 *   await browser.close();
 * })();
 * ```
 *
 * @example
 *
 * An example of disconnecting from and reconnecting to a {@link Browser}:
 * ```js
 * const puppeteer = require('puppeteer');
 *
 * (async () => {
 *   const browser = await puppeteer.launch();
 *   // Store the endpoint to be able to reconnect to Chromium
 *   const browserWSEndpoint = browser.wsEndpoint();
 *   // Disconnect puppeteer from Chromium
 *   browser.disconnect();
 *
 *   // Use the endpoint to reestablish a connection
 *   const browser2 = await puppeteer.connect({browserWSEndpoint});
 *   // Close Chromium
 *   await browser2.close();
 * })();
 * ```
 *
 * @public
 */
export class Browser extends EventEmitter {
	/**
	 * @internal
	 */
	static async _create(
		connection: Connection,
		contextIds: string[],
		ignoreHTTPSErrors: boolean,
		defaultViewport?: Viewport | null,
		process?: ChildProcess,
		closeCallback?: BrowserCloseCallback,
		targetFilterCallback?: TargetFilterCallback,
		isPageTargetCallback?: IsPageTargetCallback
	): Promise<Browser> {
		const browser = new Browser(
			connection,
			contextIds,
			ignoreHTTPSErrors,
			defaultViewport,
			process,
			closeCallback,
			targetFilterCallback,
			isPageTargetCallback
		);
		await connection.send('Target.setDiscoverTargets', {discover: true});
		return browser;
	}

	#ignoreHTTPSErrors: boolean;
	#defaultViewport?: Viewport | null;
	#process?: ChildProcess;
	#connection: Connection;
	#closeCallback: BrowserCloseCallback;
	#targetFilterCallback: TargetFilterCallback;
	#isPageTargetCallback!: IsPageTargetCallback;
	#defaultContext: BrowserContext;
	#contexts: Map<string, BrowserContext>;
	#screenshotTaskQueue: TaskQueue;
	#targets: Map<string, Target>;
	#ignoredTargets = new Set<string>();

	/**
	 * @internal
	 */
	get _targets(): Map<string, Target> {
		return this.#targets;
	}

	/**
	 * @internal
	 */
	constructor(
		connection: Connection,
		contextIds: string[],
		ignoreHTTPSErrors: boolean,
		defaultViewport?: Viewport | null,
		process?: ChildProcess,
		closeCallback?: BrowserCloseCallback,
		targetFilterCallback?: TargetFilterCallback,
		isPageTargetCallback?: IsPageTargetCallback
	) {
		super();
		this.#ignoreHTTPSErrors = ignoreHTTPSErrors;
		this.#defaultViewport = defaultViewport;
		this.#process = process;
		this.#screenshotTaskQueue = new TaskQueue();
		this.#connection = connection;
		this.#closeCallback =
			closeCallback ||
			function () {
				return undefined;
			};

		this.#targetFilterCallback =
			targetFilterCallback ||
			((): boolean => {
				return true;
			});
		this.#setIsPageTargetCallback(isPageTargetCallback);

		this.#defaultContext = new BrowserContext(this.#connection, this);
		this.#contexts = new Map();
		for (const contextId of contextIds) {
			this.#contexts.set(
				contextId,
				new BrowserContext(this.#connection, this, contextId)
			);
		}

		this.#targets = new Map();
		this.#connection.on(ConnectionEmittedEvents.Disconnected, () => {
			return this.emit(BrowserEmittedEvents.Disconnected);
		});
		this.#connection.on('Target.targetCreated', this.#targetCreated.bind(this));
		this.#connection.on(
			'Target.targetDestroyed',
			this.#targetDestroyed.bind(this)
		);
		this.#connection.on(
			'Target.targetInfoChanged',
			this.#targetInfoChanged.bind(this)
		);
	}

	/**
	 * The spawned browser process. Returns `null` if the browser instance was created with
	 * {@link Puppeteer.connect}.
	 */
	process(): ChildProcess | null {
		return this.#process ?? null;
	}

	#setIsPageTargetCallback(isPageTargetCallback?: IsPageTargetCallback): void {
		this.#isPageTargetCallback =
			isPageTargetCallback ||
			((target: Protocol.Target.TargetInfo): boolean => {
				return (
					target.type === 'page' ||
					target.type === 'background_page' ||
					target.type === 'webview'
				);
			});
	}

	/**
	 * @internal
	 */
	_getIsPageTargetCallback(): IsPageTargetCallback | undefined {
		return this.#isPageTargetCallback;
	}

	/**
	 * Creates a new incognito browser context. This won't share cookies/cache with other
	 * browser contexts.
	 *
	 * @example
	 * ```js
	 * (async () => {
	 *  const browser = await puppeteer.launch();
	 *   // Create a new incognito browser context.
	 *   const context = await browser.createIncognitoBrowserContext();
	 *   // Create a new page in a pristine context.
	 *   const page = await context.newPage();
	 *   // Do stuff
	 *   await page.goto('https://example.com');
	 * })();
	 * ```
	 */
	async createIncognitoBrowserContext(
		options: BrowserContextOptions = {}
	): Promise<BrowserContext> {
		const {proxyServer, proxyBypassList} = options;

		const {browserContextId} = await this.#connection.send(
			'Target.createBrowserContext',
			{
				proxyServer,
				proxyBypassList: proxyBypassList?.join(','),
			}
		);
		const context = new BrowserContext(
			this.#connection,
			this,
			browserContextId
		);
		this.#contexts.set(browserContextId, context);
		return context;
	}

	/**
	 * Returns an array of all open browser contexts. In a newly created browser, this will
	 * return a single instance of {@link BrowserContext}.
	 */
	browserContexts(): BrowserContext[] {
		return [this.#defaultContext, ...Array.from(this.#contexts.values())];
	}

	/**
	 * Returns the default browser context. The default browser context cannot be closed.
	 */
	defaultBrowserContext(): BrowserContext {
		return this.#defaultContext;
	}

	/**
	 * @internal
	 */
	async _disposeContext(contextId?: string): Promise<void> {
		if (!contextId) {
			return;
		}

		await this.#connection.send('Target.disposeBrowserContext', {
			browserContextId: contextId,
		});
		this.#contexts.delete(contextId);
	}

	async #targetCreated(
		event: Protocol.Target.TargetCreatedEvent
	): Promise<void> {
		const {targetInfo} = event;
		const {browserContextId} = targetInfo;
		const context =
			browserContextId && this.#contexts.has(browserContextId)
				? this.#contexts.get(browserContextId)
				: this.#defaultContext;

		if (!context) {
			throw new Error('Missing browser context');
		}

		const shouldAttachToTarget = this.#targetFilterCallback(targetInfo);
		if (!shouldAttachToTarget) {
			this.#ignoredTargets.add(targetInfo.targetId);
			return;
		}

		const target = new Target(
			targetInfo,
			context,
			() => {
				return this.#connection.createSession(targetInfo);
			},
			this.#ignoreHTTPSErrors,
			this.#defaultViewport ?? null,
			this.#screenshotTaskQueue,
			this.#isPageTargetCallback
		);
		assert(
			!this.#targets.has(event.targetInfo.targetId),
			'Target should not exist before targetCreated'
		);
		this.#targets.set(event.targetInfo.targetId, target);

		if (await target._initializedPromise) {
			this.emit(BrowserEmittedEvents.TargetCreated, target);
			context.emit(BrowserContextEmittedEvents.TargetCreated, target);
		}
	}

	async #targetDestroyed(event: {targetId: string}): Promise<void> {
		if (this.#ignoredTargets.has(event.targetId)) {
			return;
		}

		const target = this.#targets.get(event.targetId);
		if (!target) {
			throw new Error(
				`Missing target in _targetDestroyed (id = ${event.targetId})`
			);
		}

		target._initializedCallback(false);
		this.#targets.delete(event.targetId);
		target._closedCallback();
		if (await target._initializedPromise) {
			this.emit(BrowserEmittedEvents.TargetDestroyed, target);
			target
				.browserContext()
				.emit(BrowserContextEmittedEvents.TargetDestroyed, target);
		}
	}

	#targetInfoChanged(event: Protocol.Target.TargetInfoChangedEvent): void {
		if (this.#ignoredTargets.has(event.targetInfo.targetId)) {
			return;
		}

		const target = this.#targets.get(event.targetInfo.targetId);
		if (!target) {
			throw new Error(
				`Missing target in targetInfoChanged (id = ${event.targetInfo.targetId})`
			);
		}

		const previousURL = target.url();
		const wasInitialized = target._isInitialized;
		target._targetInfoChanged(event.targetInfo);
		if (wasInitialized && previousURL !== target.url()) {
			this.emit(BrowserEmittedEvents.TargetChanged, target);
			target
				.browserContext()
				.emit(BrowserContextEmittedEvents.TargetChanged, target);
		}
	}

	/**
	 * The browser websocket endpoint which can be used as an argument to
	 * {@link Puppeteer.connect}.
	 *
	 * @returns The Browser websocket url.
	 *
	 * @remarks
	 *
	 * The format is `ws://${host}:${port}/devtools/browser/<id>`.
	 *
	 * You can find the `webSocketDebuggerUrl` from `http://${host}:${port}/json/version`.
	 * Learn more about the
	 * {@link https://chromedevtools.github.io/devtools-protocol | devtools protocol} and
	 * the {@link
	 * https://chromedevtools.github.io/devtools-protocol/#how-do-i-access-the-browser-target
	 * | browser endpoint}.
	 */
	wsEndpoint(): string {
		return this.#connection.url();
	}

	/**
	 * Promise which resolves to a new {@link Page} object. The Page is created in
	 * a default browser context.
	 */
	newPage(): Promise<Page> {
		return this.#defaultContext.newPage();
	}

	/**
	 * @internal
	 */
	async _createPageInContext(contextId?: string): Promise<Page> {
		const {targetId} = await this.#connection.send('Target.createTarget', {
			url: 'about:blank',
			browserContextId: contextId || undefined,
		});
		const target = this.#targets.get(targetId);
		if (!target) {
			throw new Error(`Missing target for page (id = ${targetId})`);
		}

		const initialized = await target._initializedPromise;
		if (!initialized) {
			throw new Error(`Failed to create target for page (id = ${targetId})`);
		}

		const page = await target.page();
		if (!page) {
			throw new Error(
				`Failed to create a page for context (id = ${contextId})`
			);
		}

		return page;
	}

	/**
	 * All active targets inside the Browser. In case of multiple browser contexts, returns
	 * an array with all the targets in all browser contexts.
	 */
	targets(): Target[] {
		return Array.from(this.#targets.values()).filter((target) => {
			return target._isInitialized;
		});
	}

	/**
	 * The target associated with the browser.
	 */
	target(): Target {
		const browserTarget = this.targets().find((target) => {
			return target.type() === 'browser';
		});
		if (!browserTarget) {
			throw new Error('Browser target is not found');
		}

		return browserTarget;
	}

	/**
	 * Searches for a target in all browser contexts.
	 *
	 * @param predicate - A function to be run for every target.
	 * @returns The first target found that matches the `predicate` function.
	 *
	 * @example
	 *
	 * An example of finding a target for a page opened via `window.open`:
	 * ```js
	 * await page.evaluate(() => window.open('https://www.example.com/'));
	 * const newWindowTarget = await browser.waitForTarget(target => target.url() === 'https://www.example.com/');
	 * ```
	 */
	async waitForTarget(
		predicate: (x: Target) => boolean | Promise<boolean>,
		options: WaitForTargetOptions = {}
	): Promise<Target> {
		const {timeout = 30000} = options;
		let resolve: (value: Target | PromiseLike<Target>) => void;
		let isResolved = false;
		const targetPromise = new Promise<Target>((x) => {
			resolve = x;
		});
		this.on(BrowserEmittedEvents.TargetCreated, check);
		this.on(BrowserEmittedEvents.TargetChanged, check);
		try {
			if (!timeout) {
				return await targetPromise;
			}

			this.targets().forEach(check);
			return await waitWithTimeout(targetPromise, 'target', timeout);
		} finally {
			this.off(BrowserEmittedEvents.TargetCreated, check);
			this.off(BrowserEmittedEvents.TargetChanged, check);
		}

		async function check(target: Target): Promise<void> {
			if ((await predicate(target)) && !isResolved) {
				isResolved = true;
				resolve(target);
			}
		}
	}

	/**
	 * An array of all open pages inside the Browser.
	 *
	 * @remarks
	 *
	 * In case of multiple browser contexts, returns an array with all the pages in all
	 * browser contexts. Non-visible pages, such as `"background_page"`, will not be listed
	 * here. You can find them using {@link Target.page}.
	 */
	async pages(): Promise<Page[]> {
		const contextPages = await Promise.all(
			this.browserContexts().map((context) => {
				return context.pages();
			})
		);
		// Flatten array.
		return contextPages.reduce((acc, x) => {
			return acc.concat(x);
		}, []);
	}

	/**
	 * A string representing the browser name and version.
	 *
	 * @remarks
	 *
	 * For headless Chromium, this is similar to `HeadlessChrome/61.0.3153.0`. For
	 * non-headless, this is similar to `Chrome/61.0.3153.0`.
	 *
	 * The format of browser.version() might change with future releases of Chromium.
	 */
	async version(): Promise<string> {
		const version = await this.#getVersion();
		return version.product;
	}

	/**
	 * The browser's original user agent. Pages can override the browser user agent with
	 * {@link Page.setUserAgent}.
	 */
	async userAgent(): Promise<string> {
		const version = await this.#getVersion();
		return version.userAgent;
	}

	/**
	 * Closes Chromium and all of its pages (if any were opened). The {@link Browser} object
	 * itself is considered to be disposed and cannot be used anymore.
	 */
	async close(): Promise<void> {
		await this.#closeCallback.call(null);
		this.disconnect();
	}

	/**
	 * Disconnects Puppeteer from the browser, but leaves the Chromium process running.
	 * After calling `disconnect`, the {@link Browser} object is considered disposed and
	 * cannot be used anymore.
	 */
	disconnect(): void {
		this.#connection.dispose();
	}

	/**
	 * Indicates that the browser is connected.
	 */
	isConnected(): boolean {
		return !this.#connection._closed;
	}

	#getVersion(): Promise<Protocol.Browser.GetVersionResponse> {
		return this.#connection.send('Browser.getVersion');
	}
}
/**
 * @public
 */
export const enum BrowserContextEmittedEvents {
	/**
	 * Emitted when the url of a target inside the browser context changes.
	 * Contains a {@link Target} instance.
	 */
	TargetChanged = 'targetchanged',

	/**
	 * Emitted when a target is created within the browser context, for example
	 * when a new page is opened by
	 * {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/open | window.open}
	 * or by {@link BrowserContext.newPage | browserContext.newPage}
	 *
	 * Contains a {@link Target} instance.
	 */
	TargetCreated = 'targetcreated',
	/**
	 * Emitted when a target is destroyed within the browser context, for example
	 * when a page is closed. Contains a {@link Target} instance.
	 */
	TargetDestroyed = 'targetdestroyed',
}

/**
 * BrowserContexts provide a way to operate multiple independent browser
 * sessions. When a browser is launched, it has a single BrowserContext used by
 * default. The method {@link Browser.newPage | Browser.newPage} creates a page
 * in the default browser context.
 *
 * @remarks
 *
 * The Browser class extends from Puppeteer's {@link EventEmitter} class and
 * will emit various events which are documented in the
 * {@link BrowserContextEmittedEvents} enum.
 *
 * If a page opens another page, e.g. with a `window.open` call, the popup will
 * belong to the parent page's browser context.
 *
 * Puppeteer allows creation of "incognito" browser contexts with
 * {@link Browser.createIncognitoBrowserContext | Browser.createIncognitoBrowserContext}
 * method. "Incognito" browser contexts don't write any browsing data to disk.
 *
 * @example
 * ```js
 * // Create a new incognito browser context
 * const context = await browser.createIncognitoBrowserContext();
 * // Create a new page inside context.
 * const page = await context.newPage();
 * // ... do stuff with page ...
 * await page.goto('https://example.com');
 * // Dispose context once it's no longer needed.
 * await context.close();
 * ```
 * @public
 */
export class BrowserContext extends EventEmitter {
	#connection: Connection;
	#browser: Browser;
	#id?: string;

	/**
	 * @internal
	 */
	constructor(connection: Connection, browser: Browser, contextId?: string) {
		super();
		this.#connection = connection;
		this.#browser = browser;
		this.#id = contextId;
	}

	/**
	 * An array of all active targets inside the browser context.
	 */
	targets(): Target[] {
		return this.#browser.targets().filter((target) => {
			return target.browserContext() === this;
		});
	}

	/**
	 * This searches for a target in this specific browser context.
	 *
	 * @example
	 * An example of finding a target for a page opened via `window.open`:
	 * ```js
	 * await page.evaluate(() => window.open('https://www.example.com/'));
	 * const newWindowTarget = await browserContext.waitForTarget(target => target.url() === 'https://www.example.com/');
	 * ```
	 *
	 * @param predicate - A function to be run for every target
	 * @param options - An object of options. Accepts a timout,
	 * which is the maximum wait time in milliseconds.
	 * Pass `0` to disable the timeout. Defaults to 30 seconds.
	 * @returns Promise which resolves to the first target found
	 * that matches the `predicate` function.
	 */
	waitForTarget(
		predicate: (x: Target) => boolean | Promise<boolean>,
		options: {timeout?: number} = {}
	): Promise<Target> {
		return this.#browser.waitForTarget((target) => {
			return target.browserContext() === this && predicate(target);
		}, options);
	}

	/**
	 * An array of all pages inside the browser context.
	 *
	 * @returns Promise which resolves to an array of all open pages.
	 * Non visible pages, such as `"background_page"`, will not be listed here.
	 * You can find them using {@link Target.page | the target page}.
	 */
	async pages(): Promise<Page[]> {
		const pages = await Promise.all(
			this.targets()
				.filter((target) => {
					return (
						target.type() === 'page' ||
						(target.type() === 'other' &&
							this.#browser._getIsPageTargetCallback()?.(
								target._getTargetInfo()
							))
					);
				})
				.map((target) => {
					return target.page();
				})
		);
		return pages.filter((page): page is Page => {
			return Boolean(page);
		});
	}

	/**
	 * Returns whether BrowserContext is incognito.
	 * The default browser context is the only non-incognito browser context.
	 *
	 * @remarks
	 * The default browser context cannot be closed.
	 */
	isIncognito(): boolean {
		return Boolean(this.#id);
	}

	/**
	 * @example
	 * ```js
	 * const context = browser.defaultBrowserContext();
	 * await context.overridePermissions('https://html5demos.com', ['geolocation']);
	 * ```
	 *
	 * @param origin - The origin to grant permissions to, e.g. "https://example.com".
	 * @param permissions - An array of permissions to grant.
	 * All permissions that are not listed here will be automatically denied.
	 */
	async overridePermissions(
		origin: string,
		permissions: Permission[]
	): Promise<void> {
		const protocolPermissions = permissions.map((permission) => {
			const protocolPermission =
				WEB_PERMISSION_TO_PROTOCOL_PERMISSION.get(permission);
			if (!protocolPermission) {
				throw new Error('Unknown permission: ' + permission);
			}

			return protocolPermission;
		});
		await this.#connection.send('Browser.grantPermissions', {
			origin,
			browserContextId: this.#id || undefined,
			permissions: protocolPermissions,
		});
	}

	/**
	 * Clears all permission overrides for the browser context.
	 *
	 * @example
	 * ```js
	 * const context = browser.defaultBrowserContext();
	 * context.overridePermissions('https://example.com', ['clipboard-read']);
	 * // do stuff ..
	 * context.clearPermissionOverrides();
	 * ```
	 */
	async clearPermissionOverrides(): Promise<void> {
		await this.#connection.send('Browser.resetPermissions', {
			browserContextId: this.#id || undefined,
		});
	}

	/**
	 * Creates a new page in the browser context.
	 */
	newPage(): Promise<Page> {
		return this.#browser._createPageInContext(this.#id);
	}

	/**
	 * The browser this browser context belongs to.
	 */
	browser(): Browser {
		return this.#browser;
	}

	/**
	 * Closes the browser context. All the targets that belong to the browser context
	 * will be closed.
	 *
	 * @remarks
	 * Only incognito browser contexts can be closed.
	 */
	async close(): Promise<void> {
		assert(this.#id, 'Non-incognito profiles cannot be closed!');
		await this.#browser._disposeContext(this.#id);
	}
}
