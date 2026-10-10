const currentTime = () => Date.now();

/** Track unpaid invoices made within a window of time to limit them

  A slot is taken when an invoice starts being made, so invoices being made
  at the same time cannot go over the limit. The slot is freed when making
  the invoice fails, when it is paid, or when the window passes.

  {
    max: <Maximum Unpaid Invoices Per Window Number>
    ms: <Window Length Milliseconds Number>
  }

  @returns
  {
    free: <Free Slot Function> ({key}) => {}
    take: <Take Slot Function> ({key, [now]}) => <Slot Was Taken Bool>
  }
*/
module.exports = ({max, ms}) => {
  const slots = new Map();

  return {
    free: ({key}) => {
      slots.delete(key);
    },
    take: ({key, now}) => {
      const at = now === undefined ? currentTime() : now;

      // Invoices made before the window are no longer counted
      slots.forEach((takenAt, slot) => {
        if (at - takenAt >= ms) {
          slots.delete(slot);
        }
      });

      // Exit early when there are too many unpaid invoices in the window
      if (slots.size >= max) {
        return false;
      }

      slots.set(key, at);

      return true;
    },
  };
};
