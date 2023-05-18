import {CliInternals} from '@remotion/cli';
import type {RenderMediaOnCloudrunOutput} from '../../../api/render-media-on-cloudrun';
import {renderMediaOnCloudrun} from '../../../api/render-media-on-cloudrun';
import type {CloudrunCodec} from '../../../shared/validate-gcp-codec';
// import {validateMaxRetries} from '../../../shared/validate-retries';
import {ConfigInternals} from '@remotion/cli/config';
import {downloadFile} from '../../../api/download-file';
import {parsedCloudrunCli} from '../../args';
import {Log} from '../../log';
import {renderArgsCheck} from './helpers/renderArgsCheck';

export const RENDER_MEDIA_SUBCOMMAND = 'media';

export const renderMediaSubcommand = async (
	args: string[],
	remotionRoot: string
) => {
	const {
		serveUrl,
		cloudRunUrl,
		composition,
		outName,
		outputBucket,
		downloadName,
		privacy,
	} = await renderArgsCheck(RENDER_MEDIA_SUBCOMMAND, args);

	const {codec, reason: codecReason} = CliInternals.getFinalOutputCodec({
		cliFlag: CliInternals.parsedCli.codec,
		downloadName,
		outName: outName ?? null,
		configFile: ConfigInternals.getOutputCodecOrUndefined() ?? null,
		uiCodec: null,
	});

	const imageFormat = parsedCloudrunCli['image-format'];

	const audioCodec = parsedCloudrunCli['audio-codec'];

	const {
		chromiumOptions,
		crf,
		envVariables,
		frameRange,
		inputProps,
		pixelFormat,
		proResProfile,
		jpegQuality,
		scale,
		everyNthFrame,
		numberOfGifLoops,
		muted,
		audioBitrate,
		videoBitrate,
		height,
		width,
	} = await CliInternals.getCliOptions({
		type: 'series',
		isLambda: true,
		remotionRoot,
	});

	// Todo: Check cloudRunUrl is valid, as the error message is obtuse
	CliInternals.Log.info(
		CliInternals.chalk.gray(
			`
Sending request to Cloud Run:

Cloud Run Service URL = ${cloudRunUrl}
Type = media
Composition = ${composition}
Codec = ${codec}
Output Bucket = ${outputBucket}
Output File = ${outName ?? 'out.mp4'}
Output File Privacy = ${privacy}
${downloadName ? `		Downloaded File = ${downloadName}` : ''}
			`.trim()
		)
	);
	Log.info();

	const renderStart = Date.now();
	const progressBar = CliInternals.createOverwriteableCliOutput({
		quiet: CliInternals.quietFlagProvided(),
		cancelSignal: null,
		updatesDontOverwrite: false,
		indent: false,
	});

	const renderProgress: {
		progress: number;
		doneIn: number | null;
	} = {
		doneIn: null,
		progress: 0,
	};
	const updateProgress = () => {
		progressBar.update(
			[
				`Rendering on Cloud Run: `,
				CliInternals.makeProgressBar(renderProgress.progress),
				`${renderProgress.doneIn === null ? 'Rendering' : 'Rendered'}`,
				renderProgress.doneIn === null
					? `${Math.round(renderProgress.progress * 100)}%`
					: CliInternals.chalk.gray(`${renderProgress.doneIn}ms`),
			].join(' '),
			false
		);
	};

	const updateRenderProgress = (progress: number) => {
		renderProgress.progress = progress;
		updateProgress();
	};

	const res = await renderMediaOnCloudrun({
		cloudRunUrl,
		serveUrl,
		inputProps,
		codec: codec as CloudrunCodec,
		imageFormat,
		crf: crf ?? undefined,
		envVariables,
		pixelFormat,
		proResProfile,
		jpegQuality,
		composition,
		privacy,
		frameRange: frameRange ?? undefined,
		outputFile: outName,
		chromiumOptions,
		scale,
		numberOfGifLoops,
		everyNthFrame,
		muted,
		audioBitrate,
		videoBitrate,
		forceHeight: height,
		forceWidth: width,
		audioCodec,
		outputBucket,
		updateRenderProgress,
	});
	renderProgress.doneIn = Date.now() - renderStart;
	updateProgress();

	const success = res as RenderMediaOnCloudrunOutput;
	Log.info(`
		
		`);
	Log.info(
		CliInternals.chalk.blueBright(
			`
🤘 Rendered media on Cloud Run! 🤘

    Public URL = ${decodeURIComponent(success.publicUrl)}
    Cloud Storage Uri = ${success.cloudStorageUri}
    Size (KB) = ${Math.round(Number(success.size) / 1000)}
    Bucket Name = ${success.bucketName}
		Privacy = ${success.privacy}
    Render ID = ${success.renderId}
    Codec = ${codec} (${codecReason})
      `.trim()
		)
	);

	if (downloadName) {
		Log.info('');
		Log.info('downloading file...');

		const destination = await downloadFile({
			bucketName: success.bucketName,
			gsutilURI: success.cloudStorageUri,
			downloadName,
		});

		Log.info(
			CliInternals.chalk.blueBright(`Downloaded file to ${destination}!`)
		);
	}
};
