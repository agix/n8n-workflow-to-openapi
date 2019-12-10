require('dotenv').config({ path: './config/env' });
const axios = require('axios');
const YAML = require('yaml');
const fs = require('fs');
const path = require('path');

const n8nUrl = process.env.N8N_URL || 'http://127.0.0.1:5678';

(async () => {
  const openAPIBase = YAML.parse(
    fs.readFileSync(
      process.env.OPENAPI_BASE ||
        `${path.dirname(__filename)}/openAPIBase.yaml`,
      'utf-8',
    ),
  );
  openAPIBase.paths = {};

  const workflows = await axios.get(`${n8nUrl}/rest/workflows`);
  const workflowDetails = [];
  for (let i = 0; i < workflows.data.data.length; i += 1) {
    const workflow = workflows.data.data[i];
    // eslint-disable-next-line
    const workflowDetail = await axios.get(
      `${n8nUrl}/rest/workflows/${workflow.id}`,
    );
    workflowDetails.push(workflowDetail.data);
  }
  workflowDetails.forEach(workflow => {
    const webhooks = workflow.data.nodes.filter(
      node => node.type === 'n8n-nodes-base.webhook',
    );
    const workflowId = workflow.data.id;

    const proxyHandler = {
      get(obj, name) {
        const prox = new Proxy({ ...obj, [name]: null }, proxyHandler);
        return prox;
      },
    };

    webhooks.forEach(({ notes, name, parameters }) => {
      const route = {
        description: notes || '',
        tags: [workflow.data.name],
        responses: {
          '200': {
            content: {
              schema: {
                type: 'string',
              },
            },
          },
        },
      };
      const webhookUrl = `/webhook/${workflowId}/${encodeURI(
        name.toLowerCase(),
      )}/${parameters.path}`;
      if (typeof openAPIBase.paths[webhookUrl] === 'undefined') {
        openAPIBase.paths[webhookUrl] = {};
      }

      const regExp = new RegExp(
        `\\$node\\[\\\\"${name}\\\\"\\]\\.data[^\\}),+;(]+`,
        'g',
      );
      const relatedNodes = workflow.data.nodes.filter(
        node => JSON.stringify(node.parameters).match(regExp) !== null,
      );
      const routeParameters = [];
      const requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {},
            },
          },
        },
      };
      relatedNodes.forEach(node => {
        const params = JSON.stringify(node.parameters).match(regExp);
        let paramNotes = {};
        try {
          paramNotes = JSON.parse(node.notes);
          // eslint-disable-next-line
        } catch (e) {}

        params.forEach(param => {
          // eslint-disable-next-line
          const $node = new Proxy({}, proxyHandler);
          // eslint-disable-next-line
          const keys = Object.keys(eval(JSON.parse(`"${param}"`)));
          // eslint-disable-next-line
          let in_;
          if (keys[2] === 'headers') {
            in_ = 'header';
          } else if (keys[2] === 'query') {
            in_ = 'query';
          }
          if (typeof in_ !== 'undefined') {
            const routeParameter = {
              name: keys[3],
              in: in_,
              required: true,
              schema: {
                type: 'string',
              },
            };

            if (typeof paramNotes[keys[3]] !== 'undefined') {
              if (typeof paramNotes[keys[3]].description !== 'undefined') {
                routeParameter.description = paramNotes[keys[3]].description;
              }
              if (typeof paramNotes[keys[3]].schema !== 'undefined') {
                routeParameter.schema = paramNotes[keys[3]].schema;
              }
            }

            routeParameters.push(routeParameter);
          } else if (keys.length > 4) {
            requestBody.content['application/json'].schema.properties[
              keys[3]
            ] = {
              type: 'object',
              required: true,
            };

            if (typeof paramNotes[keys[3]] !== 'undefined') {
              if (typeof paramNotes[keys[3]].description !== 'undefined') {
                requestBody.content['application/json'].schema.properties[
                  keys[3]
                ].description = paramNotes[keys[3]].description;
              }
              if (typeof paramNotes[keys[3]].properties !== 'undefined') {
                requestBody.content['application/json'].schema.properties[
                  keys[3]
                ].properties = paramNotes[keys[3]].properties;
              }
            }
          } else {
            requestBody.content['application/json'].schema.properties[
              keys[3]
            ] = {
              type: 'string',
              required: true,
            };
            if (
              typeof paramNotes[keys[3]] !== 'undefined' &&
              typeof paramNotes[keys[3]].description !== 'undefined'
            ) {
              requestBody.content['application/json'].schema.properties[
                keys[3]
              ].example = paramNotes[keys[3]].description;
            }
          }
        });
      });

      if (routeParameters.length !== 0) {
        route.parameters = routeParameters;
      }
      if (
        Object.keys(requestBody.content['application/json'].schema.properties)
          .length !== 0
      ) {
        route.requestBody = requestBody;
      }

      openAPIBase.paths[webhookUrl][
        (parameters.httpMethod || 'GET').toLowerCase()
      ] = route;
    });
  });

  fs.writeFileSync(
    process.argv[2] || 'openAPI.yaml',
    YAML.stringify(openAPIBase),
    'utf-8',
  );
})();
