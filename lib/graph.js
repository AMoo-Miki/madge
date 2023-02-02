'use strict';

const path = require('path');
const {promisify} = require('util');
const gv = require('ts-graphviz');
const adapter = require('ts-graphviz/adapter');
const toArray = require('stream-to-array');
const interactive = require('./interactive');

const exec = promisify(require('child_process').execFile);
const writeFile = promisify(require('fs').writeFile);

/**
 * Set color on a node.
 * @param  {Object} node
 * @param  {String} color
 */
function setNodeColor(node, color) {
	node.attributes.set('color', color);
	node.attributes.set('fontcolor', color);
}

/**
 * Check if Graphviz is installed on the system.
 * @param  {Object} config
 * @return {Promise}
 */
async function checkGraphvizInstalled(config) {
	const cmd = config.graphVizPath ? path.join(config.graphVizPath, 'gvpr') : 'gvpr';

	try {
		await exec(cmd, ['-V']);
	} catch (err) {
		if (err.code === 'ENOENT') {
			throw new Error(`Graphviz could not be found. Ensure that "gvpr" is in your $PATH. ${err}`);
		} else {
			throw new Error(`Unexpected error when calling Graphviz "${cmd}". ${err}`);
		}
	}
}

/**
 * Return options to use with graphviz digraph.
 * @param  {Object} config
 * @return {Object}
 */
function createGraphvizOptions(config) {
	const graphVizOptions = config.graphVizOptions || {};

	return {
		dotCommand: config.graphVizPath ? path.join(config.graphVizPath, 'dot') : null,
		attributes: {
			// Graph
			graph: Object.assign({
				overlap: false,
				pad: 0.3,
				rankdir: config.rankdir,
				layout: config.layout,
				bgcolor: config.backgroundColor
			}, graphVizOptions.G),
			// Edge
			edge: Object.assign({
				color: config.edgeColor
			}, graphVizOptions.E),
			// Node
			node: Object.assign({
				fontname: config.fontName,
				fontsize: config.fontSize,
				color: config.nodeColor,
				shape: config.nodeShape,
				style: config.nodeStyle,
				height: 0,
				fontcolor: config.nodeColor
			}, graphVizOptions.N)
		}
	};
}

/**
 * Creates the graphviz graph.
 * @param  {Object} modules
 * @param  {Array} circular
 * @param  {Object} config
 * @param  {Object} options
 * @return {Promise}
 */
function createGraph(modules, circular, config, options) {
	const g = gv.digraph('G');
	const nodes = {};
	const groups = {};
	const subgraphs = {};
	const cyclicModules = circular.reduce((a, b) => a.concat(b), []);

	Object.keys(modules).forEach((id) => {
		if (!nodes[id]) {
			const nodeAttr = config.getNodeAttributes?.(id);

			if (nodeAttr?.group) {
				groups[id] = groups[id] || nodeAttr.group;
				subgraphs[groups[id]] = subgraphs[groups[id]] || g.subgraph(nodeAttr.group);
				nodes[id] = subgraphs[groups[id]].createNode(id, nodeAttr);
			} else {
				nodes[id] = g.createNode(id, nodeAttr);
			}
		}

		if (!modules[id].length) {
			setNodeColor(nodes[id], config.noDependencyColor);
		} else if (cyclicModules.indexOf(id) >= 0) {
			setNodeColor(nodes[id], config.cyclicNodeColor);
		}

		modules[id].forEach((depId) => {
			if (!nodes[depId]) {
				const edgeAttr = config.getNodeAttributes?.(depId);

				if (edgeAttr?.group) {
					groups[depId] = groups[depId] || edgeAttr.group;
					subgraphs[groups[depId]] = subgraphs[groups[id]] || g.subgraph(edgeAttr.group);
					nodes[depId] = subgraphs[groups[depId]].createNode(depId, edgeAttr);
				} else {
					nodes[depId] = g.createNode(depId, edgeAttr);
				}
			}

			if (!modules[depId]) {
				setNodeColor(nodes[depId], config.noDependencyColor);
			}

			if (groups[id] && groups[id] === groups[depId]) {
				subgraphs[groups[id]].createEdge([nodes[id], nodes[depId]]);
			} else {
				g.createEdge([nodes[id], nodes[depId]]);
			}
		});
	});
	const dot = gv.toDot(g);
	writeFile('temp.dot', dot);
	return adapter
		.toStream(dot, options)
		.then(toArray)
		.then(Buffer.concat);
}

/**
 * Return the module dependency graph XML SVG representation as a Buffer.
 * @param  {Object} modules
 * @param  {Array} circular
 * @param  {Object} config
 * @return {Promise}
 */
function svg(modules, circular, config) {
	const options = createGraphvizOptions(config);

	options.format = 'svg';

	return checkGraphvizInstalled(config)
		.then(() => createGraph(modules, circular, config, options));
}

module.exports.svg = svg;

/**
 * Creates an image from the module dependency graph.
 * @param  {Object} modules
 * @param  {Array} circular
 * @param  {String} imagePath
 * @param  {Object} config
 * @return {Promise}
 */
module.exports.image = function (modules, circular, imagePath, config) {
	const options = createGraphvizOptions(config);

	options.format = path.extname(imagePath).replace('.', '') || 'png';

	return checkGraphvizInstalled(config)
		.then(() => {
			return createGraph(modules, circular, config, options)
				.then((image) => writeFile(imagePath, image))
				.then(() => path.resolve(imagePath));
		});
};

/**
 * Creates an interactive html page from the module dependency graph.
 * @param  {Object} modules
 * @param  {Array} circular
 * @param  {String} pagePath
 * @param  {Object} config
 * @return {Promise}
 */
module.exports.interactive = async function (modules, circular, pagePath, config) {
	console.log('Generating interactive...');
	const svg_ = await svg(modules, circular, config);
	console.log('Got svg');
	const html_ = await interactive.generateInteractiveHtml(svg_);
	console.log('Got html');
	await  writeFile(pagePath, html_);
	console.log('Wrote html');
	return path.resolve(pagePath);
	/*
	return svg(modules, circular, config)
		.then((svg) => interactive.generateInteractiveHtml(svg))
		.then((page) => writeFile(pagePath, page))
		.then(() => path.resolve(pagePath));
	 */
};

/**
 * Return the module dependency graph as DOT output.
 * @param  {Object} modules
 * @param  {Array} circular
 * @param  {Object} config
 * @return {Promise}
 */
module.exports.dot = function (modules, circular, config) {
	const options = createGraphvizOptions(config);

	options.format = 'dot';

	return checkGraphvizInstalled(config)
		.then(() => createGraph(modules, circular, config, options))
		.then((output) => output.toString('utf8'));
};
