const {maxRelatedMenuDepth} = require('./constants');

const {isArray} = Array;

/** Check that related menus are not nested more levels deep than allowed

  The menu of the support offer is level 0, and a related offer given
  `related` offers of its own has a menu one level below the menu that lists
  it. Related offers that are not a list are not looked into.

  {
    [related]: [{
      [related]: [<Related Offer of the Related Offer Object>]
    }]
  }

  @returns
  {
    is_within_max_depth: <Related Menus Are Not Nested Too Deep Bool>
  }
*/
module.exports = ({related}) => {
  // Check the menus of a list of related offers at a level
  const isWithin = (list, level) => list.every(entry => {
    // Exit early when the entry has no menu
    if (!entry || !entry.related) {
      return true;
    }

    // Exit early when the menu of the entry would be too deep
    if (level + 1 > maxRelatedMenuDepth) {
      return false;
    }

    return !isArray(entry.related) || isWithin(entry.related, level + 1);
  });

  return {is_within_max_depth: !isArray(related) || isWithin(related, 0)};
};
