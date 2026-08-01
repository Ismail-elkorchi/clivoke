import { createCli, value } from '../src/index.ts';

const cli = createCli({
  name: 'ship',
  commands: [{
    name: 'deploy',
    options: {
      region: {
        type: value.choice(['eu', 'us']),
        flags: ['--region'],
        required: true
      }
    }
  }]
});

const result = cli.parse({ argv: ['deploy', '--region', 'eu'] });
if (result.status !== 'parsed' || result.commandKey !== 'ship deploy' ||
  result.optionValues.region !== 'eu') {
  throw new Error('Clivoke source entrypoint failed.');
}
