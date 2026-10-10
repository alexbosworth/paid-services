/** Start a task once, and give its result, or its error, to each callback
  that asks for it, in order, right away once it is done

  {
    start: <Start Task Function> (cbk) => {}
  }

  @returns
  {
    get: <Get Result Function> (cbk) => {}
  }
*/
module.exports = ({start}) => {
  const waiting = [];

  let result;

  start((...res) => {
    // Exit early when the task already gave its result
    if (!!result) {
      return;
    }

    result = res;

    return waiting.splice(0).forEach(cbk => cbk(...result));
  });

  return {get: cbk => !result ? waiting.push(cbk) : cbk(...result)};
};
