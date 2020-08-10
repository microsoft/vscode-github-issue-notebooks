/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { h, render } from 'preact';
import { AllItems } from './renderer';
import './style.css';

const api = acquireNotebookRendererApi('github-issues');

api.onDidCreateOutput(event => {
	render(<AllItems items={event.output.data[event.mimeType]} />, event.element);
});
