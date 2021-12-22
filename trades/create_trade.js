const asyncAuto = require('async/auto');
const {addPeer} = require('ln-service');
const {createInvoice} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {sendMessageToPeer} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const encodeTrade = require('./encode_trade');
const encryptTradeSecret = require('./encrypt_trade_secret');

const asNumber = n => parseFloat(n, 10);
const {floor} = Math;
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const maxDescriptionLength = 100;
const maxSecretLength = 100;
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

/** Create a new trade

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = ({ask, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToCreateTrade']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateTrade']);
        }

        return cbk();
      },

      // Get the node identity key
      getNodeId: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Ask for the public key of the node to trade with
      askForNodeId: ['getNodeId', ({getNodeId}, cbk) => {
        return ask({
          name: 'id',
          message: 'Public key of node you are trading with?',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            if (!isPublicKey(input)) {
              return 'Expected public key of node to trade with';
            }

            if (input === getNodeId.public_key) {
              return 'Expected public key of other node';
            }

            return true;
          },
        },
        cbk);
      }],

      // Ask for how to describe the payload
      askForDescription: ['askForNodeId', ({}, cbk) => {
        return ask({
          name: 'description',
          message: `Describe the secret you are offering:`,
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            if (input.length > maxDescriptionLength) {
              return 'Expected shorter description';
            }

            return true;
          },
        },
        cbk);
      }],

      // Ask for the actual payload of the trade
      askForSecret: ['askForDescription', ({askForDescription}, cbk) => {
        return ask({
          name: 'secret',
          message: 'Enter the secret you want to sell',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            if (input.length > maxSecretLength) {
              return 'Expected shorter secret value';
            }

            return true;
          },
        },
        cbk);
      }],

      // Ask for the price of the secret
      askForPrice: ['askForSecret', ({}, cbk) => {
        return ask({
          name: 'tokens',
          message: 'How much do you want to charge?',
          validate: input => {
            // Only allow numeric input
            if (!isNumber(input)) {
              return false;
            }

            // Disallow fractional values
            if (floor(input) !== asNumber(input)) {
              return 'Specified precision not supported';
            }

            return true;
          },
        },
        cbk);
      }],

      // Encrypt the secret data
      encryptPayload: [
        'askForNodeId',
        'askForSecret',
        ({askForNodeId, askForSecret}, cbk) =>
      {
        return encryptTradeSecret({
          lnd,
          secret: utf8AsHex(askForSecret.secret),
          to: askForNodeId.id,
        },
        cbk);
      }],

      // Create the invoice to purchase the unlocking secret
      createPurchaseInvoice: [
        'askForDescription',
        'askForPrice',
        'encryptPayload',
        ({askForDescription, askForPrice, encryptPayload}, cbk) =>
      {
        return createInvoice({
          lnd,
          description: askForDescription.description,
          secret: encryptPayload.payment_secret,
          tokens: asNumber(askForPrice.tokens),
        },
        cbk);
      }],

      // Encode all the trade data into wire format
      encodeTradeToWireFormat: [
        'createPurchaseInvoice',
        'encryptPayload',
        ({createPurchaseInvoice, encryptPayload}, cbk) =>
      {
        try {
          const {trade} = encodeTrade({
            auth: encryptPayload.trade_auth_tag,
            payload: encryptPayload.trade_cipher,
            request: createPurchaseInvoice.request,
          });

          return cbk(null, {trade});
        } catch (err) {
          return cbk([500, err.message]);
        }
      }],

      //Ask to send trade via p2p
      select: ['encodeTradeToWireFormat', ({}, cbk) => {
        return ask({
          default: true,
          message: 'Send Trade?',
          name: 'send',
          type: 'confirm'
        },
        cbk);
      }],

      //Send trade via p2p messaging if possible
      sendTrade: [
        'select',
        async ({encodeTradeToWireFormat, askForNodeId, select}, cbk) =>
        {
          //Exit early if not sending trade
          if(!select.send) {
            return;
          }

          try {
            //Get socket of pubkey if we have to connect
            const nodeDetails = await getNode({lnd, public_key: askForNodeId.id});

            //Get currently connected peers
            const myPeers = await getPeers({lnd});
            
            //Check if peer is already connected
            if(myPeers.peers.map(n => n.public_key).includes(askForNodeId.id)) {
              const x = await sendMessageToPeer({
                lnd,
                message: utf8AsHex(encodeTradeToWireFormat.trade),
                public_key: askForNodeId.id,
              });
              logger.info({messageSentToPeer: true});
            } 
            //Add peer and send message
            else {
                asyncDetectSeries(nodeDetails.sockets, ({socket}, cbk) => {
                addPeer({socket, lnd, public_key: askForNodeId.id}, err => {
                  return cbk(null, !err);
                });
              });

              await sendMessageToPeer({
                lnd,
                message: utf8AsHex(encodeTradeToWireFormat.trade),
                public_key: askForNodeId.id,
              });
              logger.info({messageSentToPeer: true})
            }

          } catch(err) {
            logger.error({err});
          }


        }
      ],
    },
    returnResult({reject, resolve, of: 'encodeTradeToWireFormat'}, cbk));
  });
};
