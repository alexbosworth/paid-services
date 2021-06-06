const asyncAuto = require('async/auto');
const asyncUntil = require('async/until');
const {getForwards} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {isActivityEnabled} = require('./../config');

const compact = n => n === '0.00000000' ? '0' : n;
const dayRange = d => new Date(Date.now() - (1000 * 60 * 60 * 24 * (d || 1)));
const daysPerMonth = 30;
const daysPerWeek = 7;
const isFeesOn = env => env.PAID_SERVICES_ACTIVITY_FEES === '1';
const isVolumeOn = env => env.PAID_SERVICES_ACTIVITY_VOLUME === '1';
const mtokAsBig = mtokens => (Number(mtokens / BigInt(1e3)) / 1e8).toFixed(8);
const pageLimit = 1e3;
const sum = arr => arr.reduce((sum, n) => sum + BigInt(n), BigInt(0));

/** Get a response for a routing activity summary

  {
    env: <Environment Variables Object>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    response: {
      text: <Response Text String>
    }
  }
*/
module.exports = ({env, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([400, 'ExpectedEnvToGenerateRoutingActivityResponse']);
        }

        if (!isActivityEnabled({env})) {
          return cbk([404, 'RoutingActivityServiceNotEnabled']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGenerateRoutingActivityResponse']);
        }

        return cbk();
      },

      // Get forwarding activity
      getForwards: ['validate', ({}, cbk) => {
        const after = dayRange(daysPerMonth).toISOString();
        const forwards = [];
        const start = new Date().toISOString();
        let token;

        return asyncUntil(
          cbk => cbk(null, token === false),
          cbk => {
            return getForwards({
              after,
              lnd,
              token,
              before: start,
              limit: !token ? pageLimit : undefined,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              limit = null;
              token = res.next || false;

              res.forwards.forEach(n => forwards.push(n));

              return cbk();
            });
          },
          err => {
            if (!!err) {
              return cbk([503, 'UnexpectedErrGettingRoutingActivity', {err}]);
            }

            return cbk(null, forwards);
          }
        );
      }],

      // Put forwards into bucket ranges
      forwards: ['getForwards', ({getForwards}, cbk) => {
        const dayStart = dayRange().toISOString();
        const weekStart = dayRange(daysPerWeek).toISOString();

        const daily = getForwards.filter(n => n.created_at > dayStart);
        const weekly = getForwards.filter(n => n.created_at > weekStart);

        const forwards = [
          {forwards: daily, label: '24h'},
          {forwards: weekly, label: '7d'},
          {forwards: getForwards, label: '30d'},
        ];

        return cbk(null, forwards);
      }],

      // Summarize forwarding activity
      response: ['forwards', ({forwards}, cbk) => {
        // Calculate statistics for periods
        const stats = forwards.map(bucket => {
          return {
            count: bucket.forwards.length,
            earned: mtokAsBig(sum(bucket.forwards.map(n => n.fee_mtokens))),
            label: bucket.label,
            total: mtokAsBig(sum(bucket.forwards.map(n => n.mtokens))),
          };
        });

        // Summarize statistics for response
        const summaries = stats.map(({count, earned, label, total}) => {
          const elements = [
            `${label}:`,
            `Forwarded payments: ${count}.`,
            isVolumeOn(env) ? `Total volume: ${compact(total)}.` : undefined,
            isFeesOn(env) ? `Earned fees: ${compact(earned)}.` : undefined,
          ];

          return elements.filter(n => !!n).join(' ');
        });

        return cbk(null, {response: {text: summaries.join('\n')}});
      }],
    },
    returnResult({reject, resolve, of: 'response'}, cbk));
  });
};
