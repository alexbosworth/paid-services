const isServiceEnabled = require('./is_service_enabled');
const schema = require('./schema');

const {keys} = Object;

/** Derive the set of registered paid services that the node will fulfill

  {
    env: <Environment Variables Object>
  }

  @returns
  {
    services: [{
      [description]: <Service Description String>
      [fields]: [{
        description: <Argument Description String>
        limit: <Argument Byte Limit Number>
        type: <Field Type Number String>
      }]
      id: <Service Id Number String>
      is_enabled: <Service Is Enabled Bool>
      name: <Service Name String>
    }]
  }
*/
module.exports = ({env}) => {
  const services = keys(schema.ids).map(id => {
    return {
      id,
      description: schema.descriptions[id],
      fields: schema.fields[id],
      is_enabled: isServiceEnabled({env, id}).is_enabled,
      name: schema.ids[id],
    };
  });

  return {services};
};
