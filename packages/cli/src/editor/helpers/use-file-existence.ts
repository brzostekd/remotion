import {useEffect, useRef, useState} from 'react';
import {subscribeToEvent} from '../../event-source';
import type {EventSourceEvent} from '../../event-source-events';
import {
	subscribeToFileExistenceWatcher,
	unsubscribeFromFileExistenceWatcher,
} from '../components/RenderQueue/actions';

export const useFileExistence = (outName: string) => {
	const [exists, setExists] = useState(false);
	const currentOutName = useRef('');
	currentOutName.current = outName;

	useEffect(() => {
		subscribeToFileExistenceWatcher({file: outName}).then((_exists) => {
			if (currentOutName.current === outName) {
				setExists(_exists);
			}
		});

		return () => {
			unsubscribeFromFileExistenceWatcher({file: outName});
		};
	}, [outName]);

	useEffect(() => {
		const listener = (event: EventSourceEvent) => {
			if (event.type !== 'watched-file-deleted') {
				return;
			}

			if (event.file !== currentOutName.current) {
				return;
			}

			if (currentOutName.current === outName) {
				setExists(false);
			}
		};

		const unsub = subscribeToEvent('watched-file-deleted', listener);
		return () => {
			unsub();
		};
	}, [outName]);

	useEffect(() => {
		const listener = (event: EventSourceEvent) => {
			if (event.type !== 'watched-file-undeleted') {
				return;
			}

			if (event.file !== outName) {
				return;
			}

			if (currentOutName.current === outName) {
				setExists(true);
			}
		};

		const unsub = subscribeToEvent('watched-file-undeleted', listener);
		return () => {
			unsub();
		};
	}, [outName]);

	return exists;
};