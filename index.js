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
  openAPIBase.tags = [];
  openAPIBase.components = {
    securitySchemes: {}
  };

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

    const startNode = workflow.data.nodes.find(
      node => node.type === 'n8n-nodes-base.start',
    );
    if(webhooks.length > 0) {
      openAPIBase.tags.push({
        name: workflow.data.name,
        description: startNode.notes || '',
      })
    }

    webhooks.forEach(({ credentials, notes, name, parameters, webhookId }) => {
      const defaultResponseSchema = {
        'text/plain': {
          schema: {
            type: 'string',
            example: 'test',
          }
        }
      }

      let noteObject = {
        description: (notes || ''),
        responseDescription: '',
        responseSchema: defaultResponseSchema,
      }
      try {
        noteObject = JSON.parse(notes);
      } catch(e) {}
      const responseDescription = noteObject.responseDescription || '';
      const responseSchema = noteObject.responseSchema || defaultResponseSchema;
      delete noteObject.responseDescription;
      delete noteObject.responseSchema;
      const route = {
        ...noteObject,
        tags: [workflow.data.name],
        responses: {
          '200': {
            description: responseDescription,
            content: {...responseSchema},
          },
        },
      };
      if(typeof(credentials) !== 'undefined') {
        const [securityType, securityName] = Object.entries(credentials)[0];
        route.security = [{
          [securityName]: [],
        }]
        if(securityType === 'httpHeaderAuth') {
          openAPIBase.components.securitySchemes[securityName] = {
            type: 'apiKey',
            in: 'header',
            name: securityName,
          }
        } else {
          openAPIBase.components.securitySchemes[securityName] = {
            type: 'http',
            scheme: 'basic',
          }
        }
      }
      let webhookUrl;
      if(typeof(webhookId) === 'undefined') {
        webhookUrl = `/webhook/${workflowId}/${encodeURI(
          name.toLowerCase(),
        )}/${parameters.path}`;
      } else {
        webhookUrl = `/webhook/${parameters.path}`;
      }

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
        content: {
          'application/x-www-form-urlencoded': {
            schema: {
              required: [],
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
          const paramNote = paramNotes[keys[3]] || {};
          if (typeof in_ !== 'undefined') {
            const routeParameter = {
              ...paramNote,
              name: keys[3],
              in: in_,
              required: true,
              schema: {
                type: 'string',
              },
            };

            routeParameters.push(routeParameter);
          } else if (keys.length > 4) {
            if(requestBody.content['application/x-www-form-urlencoded'].schema.required.includes(keys[3]) === false) {
              requestBody.content['application/x-www-form-urlencoded'].schema.required.push(keys[3])
            }
            requestBody.content['application/x-www-form-urlencoded'].schema.properties[
              keys[3]
            ] = {
              type: 'object',
              ...paramNote,
            };
          } else {
            if(requestBody.content['application/x-www-form-urlencoded'].schema.required.includes(keys[3]) === false) {
              requestBody.content['application/x-www-form-urlencoded'].schema.required.push(keys[3])
            }
            requestBody.content['application/x-www-form-urlencoded'].schema.properties[
              keys[3]
            ] = {
              type: 'string',
              ...paramNote,
            };
          }
        });
      });

      if (routeParameters.length !== 0) {
        route.parameters = routeParameters;
      }
      if (
        Object.keys(requestBody.content['application/x-www-form-urlencoded'].schema.properties)
          .length !== 0
      ) {
        requestBody.content['application/json'] = requestBody.content['application/x-www-form-urlencoded'];
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
