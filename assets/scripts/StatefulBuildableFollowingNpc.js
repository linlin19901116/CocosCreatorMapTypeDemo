const BasePlayer = require("./BasePlayer");

window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE = {
  MOVING_OUT: 1,
  MOVING_IN: 2, // This state will be active when "boundStatefulBuildable" is moved to a new "fixedSpriteCentreContinuousPos" where an available "NewGrandSrc" can be found.
  STUCK_WHILE_MOVING_OUT: 3,
  STUCK_WHILE_MOVING_IN: 4,
  STUCK_NO_AVAILABLE_GRAND_SRC: 5, // This state is only active when "boundStatefulBuildable" is moved to a new "fixedSpriteCentreContinuousPos" where NO AVAILABLE "NewGrandSrc" can be found, in such case it could yield "grandSrc == null && preGrandSrc != null".
  STAYING_WHILE_MOVING_OUT: 8,
  STAYING_WHILE_MOVING_IN: 9,
  STAYING_AT_DESTINATION_AFTER_MOVING_OUT: 10,
  STAYING_AT_DESTINATION_AFTER_MOVING_IN: 11, // A.k.a. staying at "grandSrc".
};

const INFINITY_FOR_PATH_FINDING = 1600;
const DOUBLE_BARRIER_PATH_LENGTH = (INFINITY_FOR_PATH_FINDING * 2);
const QUARAL_BARRIER_PATH_LENGTH = (INFINITY_FOR_PATH_FINDING * 4);

module.export = cc.Class({
  extends: BasePlayer,

  properties: {
    speciesName: {
      default: "DUCK",
    },
    walkingAnimNode: {
      type: cc.Node,
      default: null
    },
    stayingAnimNode: {
      type: cc.Node,
      default: null
    },
    uuidLabel: {
      type: cc.Label,
      default: null
    },
    cacheCollectionNode: {
      type: cc.Node,
      default: null
    },
  },

  ctor() {
    this.clips = {
      '01': 'TopRight',
      '0-1': 'BottomLeft',
      '-20': 'TopLeft',
      '20': 'BottomRight',
      '-21': 'TopLeft',
      '21': 'TopRight',
      '-2-1': 'BottomLeft',
      '2-1': 'BottomRight'
    };
    this.state = STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_AT_DESTINATION_AFTER_MOVING_IN;
    this.drawer = null;

    this.boundStatefulBuildable = null; // It's a pointer to an instance of class "StatefulBuildableInstance" a.k.a. a "cc.Component class script instance".
    this.preGrandSrc = null;
    this.grandSrc = null;
    this.currentSrc = null;
    this.currentDestination = null;
    this.discreteBarrierGridsToIgnore = null;

    // Caches for "LPA*" and "D* Lite" algorithms. [BEGINS]
    this.discreteCurrentSrc = null;
    this.discreteCurrentDestination = null;
    this.pqForPathFinding = null;
    this.rhsCache = null;
    this.gCache = null;
    this.movementStops = null;
    // [ENDS]

  },

  _heuristicallyEstimatePathLength(p1, p2) {
    // const absDx = Math.abs(p1.x - p2.x);
    // const absDy = Math.abs(p1.y - p2.y);
    // let ret = Math.sqrt(absDx * absDx + absDy * absDy);

    const absDx = Math.abs(p1.x - p2.x);
    const absDy = Math.abs(p1.y - p2.y);
    let ret = absDx + absDy;    

    const p1IsBarrier = (null != window.cachedKnownBarrierGridDict[p1.x] && true == window.cachedKnownBarrierGridDict[p1.x][p1.y]);
    const p1BarrierIsIgnored = (null != this.discreteBarrierGridsToIgnore && null != this.discreteBarrierGridsToIgnore[p1.x] && true == this.discreteBarrierGridsToIgnore[p1.x][p1.y]);

    if (p1IsBarrier && false == p1BarrierIsIgnored) {
      ret += INFINITY_FOR_PATH_FINDING;
    }

    const p2IsBarrier = (null != window.cachedKnownBarrierGridDict[p2.x] && true == window.cachedKnownBarrierGridDict[p2.x][p2.y]);
    const p2BarrierIsIgnored = (null != this.discreteBarrierGridsToIgnore && null != this.discreteBarrierGridsToIgnore[p2.x] && true == this.discreteBarrierGridsToIgnore[p2.x][p2.y]);
    if (p2IsBarrier && false == p2BarrierIsIgnored) {
      ret += INFINITY_FOR_PATH_FINDING;
    }
    return ret;
  },

  start() {
    BasePlayer.prototype.start.call(this);
  },
    
  _neighbourOffsetToMemberVarName(neighbourOffset) {
    return ("_" + neighbourOffset.dx + "_" + neighbourOffset.dy + "_").replace("+", "plus").replace("-", "minus");
  },

  _cacheValueToString(g, gAndHSum) {
    return "(" + g + ", " + gAndHSum.toFixed(1) + ")";
  },

  _initCacheCollectionLabels() {
    const self = this;
    self.uuidLabel.string = self.node.uuid;
    const discreteCurrentPos = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.node.position, cc.v2(0, 0));
    
    for (let neighbourOffset of window.NEIGHBOUR_DISCRETE_OFFSETS) {
      const discreteNeighbourPos = {
        x: discreteCurrentPos.x + neighbourOffset.dx,
        y: discreteCurrentPos.y + neighbourOffset.dy,
      };

      const continuousPtInMapNode = tileCollisionManager._continuousFromCentreOfDiscreteTile(self.mapNode, self.mapIns.tiledMapIns, null, discreteNeighbourPos.x, discreteNeighbourPos.y);

      const continuousDiffVecInSelfNode = continuousPtInMapNode.sub(self.node.position);
      const theMemberVarName = self._neighbourOffsetToMemberVarName(neighbourOffset);
      const theLabelNode = new cc.Node(theMemberVarName); 
      const theLabel = theLabelNode.addComponent(cc.Label); 
      theLabel.string = theMemberVarName;

      theLabelNode.setPosition(continuousDiffVecInSelfNode);
      setLocalZOrder(theLabelNode, CORE_LAYER_Z_INDEX.DRAGGING_ITEM);
      self[theMemberVarName] = theLabel;
      safelyAddChild(self.cacheCollectionNode, theLabelNode);
    }

    const continuousPtInMapNode = tileCollisionManager._continuousFromCentreOfDiscreteTile(self.mapNode, self.mapIns.tiledMapIns, null, discreteCurrentPos.x, discreteCurrentPos.y);
    const continuousDiffVecInSelfNode = continuousPtInMapNode.sub(self.node.position);
    const theMemberVarName = self._neighbourOffsetToMemberVarName({dx: 0, dy: 0});
    const theLabelNode = new cc.Node(theMemberVarName); 
    const theLabel = theLabelNode.addComponent(cc.Label); 
    theLabel.string = theMemberVarName;

    theLabelNode.setPosition(continuousDiffVecInSelfNode);
    setLocalZOrder(theLabelNode, CORE_LAYER_Z_INDEX.DRAGGING_ITEM);
    self[theMemberVarName] = theLabel;
    safelyAddChild(self.cacheCollectionNode, theLabelNode);
  },

  onLoad() {
    const self = this;
    /*
    * Deliberately NOT calling "BasePlayer.prototype.onLoad".
    *
    * The class "BasePlayer" switches to play the "appropriate `cc.AnimationClip` of `scheduledDirection` within `this.clips`" when "scheduleNewDirection" is called. 
    * 
    * To switch "cc.Animation", the "this.animComp" will be tuned to point to appropriate objects.
    *
    * -- YFLu
    */

    self._initCacheCollectionLabels();
    self.setAnim(self.speciesName, () => {
      self.scheduleNewDirection(self._generateRandomDirection());
      self.transitToStaying(() => {
        // Deliberately left blank. -- YFLu
      });
    });
  },

  transitToStaying(cb) {
    const self = this;
    // Don't execute the calculation of "continuous -> discrete coordinate" before checking the current state.
    let discretizedSelfNodePos = null;
    let discretizedDestinaion = null;

    switch (this.state) {
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_IN:
        discretizedSelfNodePos = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.node.position, cc.v2(0, 0));
        discretizedDestinaion = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.currentDestination, cc.v2(0, 0));
        if (discretizedSelfNodePos.x == discretizedDestinaion.x && discretizedSelfNodePos.y == discretizedDestinaion.y) {
          this.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_AT_DESTINATION_AFTER_MOVING_IN;
        } else {
          this.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_WHILE_MOVING_IN;
        }
        break;
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_OUT:
        discretizedSelfNodePos = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.node.position, cc.v2(0, 0));
        discretizedDestinaion = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.currentDestination, cc.v2(0, 0));
        if (discretizedSelfNodePos.x == discretizedDestinaion.x && discretizedSelfNodePos.y == discretizedDestinaion.y) {
          this.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_AT_DESTINATION_AFTER_MOVING_OUT;
        } else {
          this.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_WHILE_MOVING_OUT;
        }
        break;
      default:
        break;
    }

    self.setAnim(self.speciesName, () => {
      const clipKey = self.clips[self.scheduledDirection.dx.toString() + self.scheduledDirection.dy.toString()];
      self.animComp.play(clipKey);
      if (cb) {
        cb();
      }
    });
  },

  transitToStuck(cb) {
    const self = this;
    switch (this.state) {
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_IN:
        this.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STUCK_WHILE_MOVING_IN;
        break;
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_OUT:
        this.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STUCK_WHILE_MOVING_OUT;
        break;
      default:
        break;
    }

    self.setAnim(self.speciesName, () => {
      const clipKey = self.clips[self.scheduledDirection.dx.toString() + self.scheduledDirection.dy.toString()];
      self.animComp.play(clipKey);
      if (cb) {
        cb();
      }
    });
  },

  transitToMoving(cb) {
    const self = this;
    switch (this.state) {
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_AT_DESTINATION_AFTER_MOVING_OUT:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_WHILE_MOVING_IN:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STUCK_WHILE_MOVING_IN:
        this.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_IN;
        break;
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_AT_DESTINATION_AFTER_MOVING_IN:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_WHILE_MOVING_OUT:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STUCK_WHILE_MOVING_OUT:
        this.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_OUT;
        break;
      default:
        break;
    }
    self.setAnim(self.speciesName, () => {
      const clipKey = self.clips[self.scheduledDirection.dx.toString() + self.scheduledDirection.dy.toString()];
      self.animComp.play(clipKey);
      if (cb) {
        cb();
      }
    });
  },

  refreshGrandSrcAndCurrentDestination() {
    const self = this;
    self.preGrandSrc = self.grandSrc;
    self.grandSrc = self.boundStatefulBuildable.fixedSpriteCentreContinuousPos.add(self.boundStatefulBuildable.estimatedSpriteCentreToAnchorTileCentreContinuousOffset); // Temporarily NOT seeing the "barrier grids occupied by `boundStatefulBuildable`" as a barrier to its own following NPCs. -- YFLu

    /*
     * The change of `grandSrc` implies a change of `discreteBarrierGridsToIgnore`.
     */
    self.discreteBarrierGridsToIgnore = {};
    const discreteWidth = self.boundStatefulBuildable.discreteWidth;
    const discreteHeight = self.boundStatefulBuildable.discreteHeight;

    const anchorTileDiscretePos = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.boundStatefulBuildable.node.position.add(self.boundStatefulBuildable.estimatedSpriteCentreToAnchorTileCentreContinuousOffset), cc.v2(0, 0));


    for (let discreteX = anchorTileDiscretePos.x; discreteX < (anchorTileDiscretePos.x + discreteWidth); ++discreteX) {
      if (null == self.discreteBarrierGridsToIgnore[discreteX]) {
        self.discreteBarrierGridsToIgnore[discreteX] = {};
      }
      for (let discreteY = anchorTileDiscretePos.y; discreteY < (anchorTileDiscretePos.y + discreteHeight); ++discreteY) {
        self.discreteBarrierGridsToIgnore[discreteX][discreteY] = true;
      }
    }

    self.currentSrc = self.node.position;
    self.discreteCurrentSrc = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.currentSrc, cc.v2(0, 0));

    self.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_IN;
    self.refreshCurrentDestination();

    self._initPathFindingCaches();
    self.computePathFindingCaches();
  },

  refreshCurrentDestination() {
    /**
    * WARNING: You should update `this.state` before calling this method. 
    */
    let previousDiscretizedDestinaion = null;
    let discretizedDestinaion = null;
    const self = this;
    switch (self.state) {
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_IN:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STUCK_WHILE_MOVING_IN:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_WHILE_MOVING_IN:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_AT_DESTINATION_AFTER_MOVING_OUT:
        if (null != self.currentDestination) {
          previousDiscretizedDestinaion = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.currentDestination, cc.v2(0, 0));
        }

        self.currentDestination = self.grandSrc;
        discretizedDestinaion = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.currentDestination, cc.v2(0, 0));
        self.discreteCurrentDestination = discretizedDestinaion;
        break;
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_OUT:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STUCK_WHILE_MOVING_OUT:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_WHILE_MOVING_OUT:
      case window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_AT_DESTINATION_AFTER_MOVING_IN:
        // Deliberately left blank. -- YFLu
        break;
      default:
        break;
    }

    if (null != previousDiscretizedDestinaion) {
      let previousStatefulBuildableFollowingNpcDestinationDictRecord = null;
      if (null != window.reverseStatefulBuildableFollowingNpcDestinationDict[previousDiscretizedDestinaion.x]) {
        previousStatefulBuildableFollowingNpcDestinationDictRecord = window.reverseStatefulBuildableFollowingNpcDestinationDict[previousDiscretizedDestinaion.x][previousDiscretizedDestinaion.y];
      }
      if (null != previousStatefulBuildableFollowingNpcDestinationDictRecord && null != previousStatefulBuildableFollowingNpcDestinationDictRecord[self.node.uuid]) {
        delete previousStatefulBuildableFollowingNpcDestinationDictRecord[self.node.uuid];
        // Lazy clearance.
        if (0 >= Object.keys(previousStatefulBuildableFollowingNpcDestinationDictRecord).length) {
          window.reverseStatefulBuildableFollowingNpcDestinationDict[previousDiscretizedDestinaion.x][previousDiscretizedDestinaion.y] = null;
          delete window.reverseStatefulBuildableFollowingNpcDestinationDict[previousDiscretizedDestinaion.x][previousDiscretizedDestinaion.y];
          if (0 >= Object.keys(window.reverseStatefulBuildableFollowingNpcDestinationDict[previousDiscretizedDestinaion.x]).length) {
            window.reverseStatefulBuildableFollowingNpcDestinationDict[previousDiscretizedDestinaion.x] = null;
            delete window.reverseStatefulBuildableFollowingNpcDestinationDict[previousDiscretizedDestinaion.x];
          }
        }
      }
    }

    if (null != discretizedDestinaion) {
      let reverseStatefulBuildableFollowingNpcDestinationDictRecord = null;
      // Lazy init.
      if (null == window.reverseStatefulBuildableFollowingNpcDestinationDict[discretizedDestinaion.x]) {
        window.reverseStatefulBuildableFollowingNpcDestinationDict[discretizedDestinaion.x] = {};
      }
      if (null == window.reverseStatefulBuildableFollowingNpcDestinationDict[discretizedDestinaion.x][discretizedDestinaion.y]) {
        window.reverseStatefulBuildableFollowingNpcDestinationDict[discretizedDestinaion.x][discretizedDestinaion.y] = {};
      }

      reverseStatefulBuildableFollowingNpcDestinationDictRecord = window.reverseStatefulBuildableFollowingNpcDestinationDict[discretizedDestinaion.x][discretizedDestinaion.y];
      reverseStatefulBuildableFollowingNpcDestinationDictRecord[self.node.uuid] = self;
    }
  },

  onCollisionEnter(otherCollider, selfCollider) {
    BasePlayer.prototype.onCollisionEnter.call(this, otherCollider, selfCollider);
    const self = this.getComponent(this.node.name);
    switch (otherCollider.node.name) {
      case "PolygonBoundaryBarrier":
        let collidingWithAssociatedStatefulBuildable = false;
        const boundStatefulBuildableOfCollider = otherCollider.boundStatefulBuildable;
        collidingWithAssociatedStatefulBuildable = (null != boundStatefulBuildableOfCollider && (boundStatefulBuildableOfCollider.uuid == self.boundStatefulBuildable.uuid));
        if (true == collidingWithAssociatedStatefulBuildable) {
          return;
        }
        const availableNewPositionNearby = window.findNearbyNonBarrierGridByBreathFirstSearch(self.mapNode, self.node.position, 1);
        if (null == availableNewPositionNearby) {
          self.currentDestination = self.grandSrc;
          self.discreteCurrentDestination = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.currentDestination, cc.v2(0, 0));
          self.node.setPosition(self.grandSrc);
          self.state = window.STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.STAYING_AT_DESTINATION_AFTER_MOVING_IN;
        } else {
          self.node.setPosition(availableNewPositionNearby);
        }
        break;
      default:
        break;
    }
  },

  onCollisionStay(otherCollider, selfCollider) {
    // TBD.
  },

  onCollisionExit(otherCollider, selfCollider) {
    BasePlayer.prototype.onCollisionEnter.call(this, otherCollider, selfCollider);
    const self = this.getComponent(this.node.name);
    switch (otherCollider.node.name) {
      case "PolygonBoundaryBarrier":
        // Deliberately not handling. -- YFLu
        break;
      default:
        break;
    }
  },

  setAnim(speciesName, cb) {
    const self = this;
    let dirPath = null;

    const selfStateWhenCalled = self.state;

    switch (selfStateWhenCalled) {
      case STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_OUT:
      case STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_IN:
        if (null != self.walkingAnimComp) {
          self.stayingAnimNode.active = false;
          self.walkingAnimNode.active = true;
          self.animComp = self.walkingAnimComp;
          if (cb) {
            cb(false);
          }
          return;
        }
        dirPath = constants.NPC_ANIM[speciesName].WALKING;
        break;
      default:
        if (null != self.stayingAnimComp) {
          self.walkingAnimNode.active = false;
          self.stayingAnimNode.active = true;
          self.animComp = self.stayingAnimComp;
          if (cb) {
            cb(false);
          }
          return;
        }
        dirPath = constants.NPC_ANIM[speciesName].STAYING;
        break;
    }

    cc.loader.loadResDir(dirPath, cc.AnimationClip, function(err, animClips, urls) {
      if (null != err) {
        cc.warn(err);
      }
      switch (selfStateWhenCalled) {
        case STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_OUT:
        case STATEFUL_BUILDABLE_FOLLOWING_NPC_STATE.MOVING_IN:
          const walkingAnimComp = self.walkingAnimNode.getComponent(cc.Animation);
          for (let clip of animClips) {
            walkingAnimComp.addClip(clip);
          }
          self.walkingAnimComp = walkingAnimComp;
          self.animComp = walkingAnimComp;
          self.stayingAnimNode.active = false;
          self.walkingAnimNode.active = true;
          break;
        default:
          const stayingAnimComp = self.stayingAnimNode.getComponent(cc.Animation);
          for (let clip of animClips) {
            stayingAnimComp.addClip(clip);
          }
          self.stayingAnimComp = stayingAnimComp;
          self.animComp = stayingAnimComp;
          self.walkingAnimNode.active = false;
          self.stayingAnimNode.active = true;
          break;
      }
      if (cb) {
        cb(true);
      }
    });
  },

  _calculatePriorityPair(discretePos) {
    const discretePosKey = window.describe(discretePos);
    const minOfGAndRhs = Math.min(this.rhsCache[discretePosKey], this.gCache[discretePosKey]);
    return {
      k1: minOfGAndRhs + this._heuristicallyEstimatePathLength(discretePos, this.discreteCurrentDestination),
      k2: minOfGAndRhs,
    };
  },

  _initPathFindingCaches() {
    const self = this;

    const tiledMapIns = self.mapIns.tiledMapIns;
    const mapSizeDiscrete = tiledMapIns.getMapSize();

    const uniformDiscreteMargin = 0;
    self.gCache = {};
    self.rhsCache = {};
    for (let discretePosXInMap = uniformDiscreteMargin; discretePosXInMap < mapSizeDiscrete.width - uniformDiscreteMargin; ++discretePosXInMap) {
      for (let discretePosYInMap = uniformDiscreteMargin; discretePosYInMap < mapSizeDiscrete.height - uniformDiscreteMargin; ++discretePosYInMap) {
        const discreteNeighbourPosKey = window.describe({
          x: discretePosXInMap,
          y: discretePosYInMap
        });
        self.gCache[discreteNeighbourPosKey] = INFINITY_FOR_PATH_FINDING;
        self.rhsCache[discreteNeighbourPosKey] = INFINITY_FOR_PATH_FINDING;
      }
    }
    self.rhsCache[window.describe(self.discreteCurrentSrc)] = 0;

    self.pqForPathFinding = new window.PriorityQueue((element) => {
      const priorityPair = self._calculatePriorityPair(element);
      const base = 1000000000000;
      return priorityPair.k1 * base + priorityPair.k2;
    });

    self.pqForPathFinding.push(self.discreteCurrentSrc);
  },

  computePathFindingCaches() {
    const self = this;

    const tiledMapIns = self.mapIns.tiledMapIns;
    const mapSizeDiscrete = tiledMapIns.getMapSize();
    const maxExpanderTrialCount = ((mapSizeDiscrete.width * mapSizeDiscrete.height));

    let expanderTrialCount = 0;

    const discreteCurrentDestinationKey = window.describe(self.discreteCurrentDestination);
    while (0 < self.pqForPathFinding.size()) {
      const topElementScore = self.pqForPathFinding.scoreFunction(self.pqForPathFinding.content[0]);
      const discreteCurrentDestinationScore = self.pqForPathFinding.scoreFunction(self.discreteCurrentDestination);
      if (topElementScore >= discreteCurrentDestinationScore && self.rhsCache[discreteCurrentDestinationKey] == self.gCache[discreteCurrentDestinationKey]) {
        break;
      }

      const expanderPos = self.pqForPathFinding.pop();
      const expanderPosKey = window.describe(expanderPos);
      if (self.gCache[expanderPosKey] > self.rhsCache[expanderPosKey]) {
        self.gCache[expanderPosKey] = self.rhsCache[expanderPosKey];
        // Traversing all possible successors.
        for (let neighbourOffset of window.NEIGHBOUR_DISCRETE_OFFSETS) {
          const discreteNeighbourPos = {
            x: expanderPos.x + neighbourOffset.dx,
            y: expanderPos.y + neighbourOffset.dy,
          };
          if (discreteNeighbourPos.x < 0
            ||
            discreteNeighbourPos.x >= mapSizeDiscrete.width
            ||
            discreteNeighbourPos.y < 0
            ||
            discreteNeighbourPos.y >= mapSizeDiscrete.height
          ) {
            continue;
          }
          self.updatePathFindingCachesForDiscretePosition(discreteNeighbourPos);
        }
      } else {
        self.gCache[expanderPosKey] = INFINITY_FOR_PATH_FINDING;
        // Traversing all possible successors.
        for (let neighbourOffset of window.NEIGHBOUR_DISCRETE_OFFSETS) {
          const discreteNeighbourPos = {
            x: expanderPos.x + neighbourOffset.dx,
            y: expanderPos.y + neighbourOffset.dy,
          };
          if (discreteNeighbourPos.x < 0
            ||
            discreteNeighbourPos.x >= mapSizeDiscrete.width
            ||
            discreteNeighbourPos.y < 0
            ||
            discreteNeighbourPos.y >= mapSizeDiscrete.height
          ) {
            continue;
          }
          self.updatePathFindingCachesForDiscretePosition(discreteNeighbourPos);
        }
        self.updatePathFindingCachesForDiscretePosition(expanderPos);
      }

      ++expanderTrialCount;
      if (expanderTrialCount > maxExpanderTrialCount) {
        break;
      }
    }
  },

  _printGAndHSum() {
    const self = this;
    console.log("self.node.uuid=", self.node.uuid, ", self.discreteCurrentSrc=", self.discreteCurrentSrc, ", self.discreteCurrentDestination=", self.discreteCurrentDestination);
    for (let k in self.gCache) {
      if (INFINITY_FOR_PATH_FINDING <= self.gCache[k]) {
        continue;
      }
      const splitted = k.split(',');
      const x = parseInt(splitted[0]);
      const y = parseInt(splitted[1]);
      console.log(k, self.gCache[k], self.gCache[k] + self._heuristicallyEstimatePathLength({
          x: x,
          y: y
        }, self.discreteCurrentDestination));
    }
  },

  updatePathFindingCachesForDiscretePosition(discretePos) {
    const self = this;
    if (null == self.discreteCurrentSrc) {
      return;
    }

    const tiledMapIns = self.mapIns.tiledMapIns;
    const mapSizeDiscrete = tiledMapIns.getMapSize();
    const discretePosKey = window.describe(discretePos);

    if (discretePos.x != self.discreteCurrentSrc.x || discretePos.y != self.discreteCurrentSrc.y) {
      let minRhs = INFINITY_FOR_PATH_FINDING;
      // Traversing all possible predecessors.
      for (let neighbourOffset of window.NEIGHBOUR_DISCRETE_OFFSETS) {
        const discreteNeighbourPos = {
          x: discretePos.x + neighbourOffset.dx,
          y: discretePos.y + neighbourOffset.dy,
        };
        if (discreteNeighbourPos.x < 0
          ||
          discreteNeighbourPos.x >= mapSizeDiscrete.width
          ||
          discreteNeighbourPos.y < 0
          ||
          discreteNeighbourPos.y >= mapSizeDiscrete.height
        ) {
          continue;
        }
        const discreteNeighbourPosKey = window.describe(discreteNeighbourPos);

        let edgeCost = 1; /* Edge cost is currently constant. -- YFLu */
        const neightbourIsBarrier = (null != window.cachedKnownBarrierGridDict[discreteNeighbourPos.x] && true == window.cachedKnownBarrierGridDict[discreteNeighbourPos.x][discreteNeighbourPos.y]);
        const thatBarrierIsIgnored = (null != self.discreteBarrierGridsToIgnore && null != self.discreteBarrierGridsToIgnore[discreteNeighbourPos.x] && true == self.discreteBarrierGridsToIgnore[discreteNeighbourPos.x][discreteNeighbourPos.y]);

        if (true == neightbourIsBarrier && false == thatBarrierIsIgnored) {
          edgeCost = INFINITY_FOR_PATH_FINDING;
        }

        const candidateValue = self.gCache[discreteNeighbourPosKey] + edgeCost; // Allowing `gCache[*]` to contain over INFINITY_FOR_PATH_FINDING values, which won't be included in `self._printGAndHSum()` for path inspection.  
        if (candidateValue < minRhs) {
          // We rely on selecting a "minRhs" to effectively select a "proper predecessor", instead of "successor" for the "discretePos(input parameter)".
          minRhs = candidateValue;
        }
      }
      self.rhsCache[discretePosKey] = minRhs;
    }

    // Remove the currently updating position from `pqForPathFinding` if exists there.
    for (let i = 0; i < self.pqForPathFinding.size(); ++i) {
      const toCompare = self.pqForPathFinding.content[i];
      if (toCompare.x != discretePos.x || toCompare.y != discretePos.y) continue;
      self.pqForPathFinding.remove(toCompare);
      break;
    }


    if (self.gCache[discretePosKey] != self.rhsCache[discretePosKey]) {
      self.pqForPathFinding.push(discretePos);
    }
  },

  update(dt) {
    if (null == this.discreteCurrentSrc || null == this.currentDestination || null == this.discreteCurrentDestination || null == this.gCache || null == this.rhsCache) {
      return;
    }
    if (null == this.boundStatefulBuildable && null == this.boundStatefulBuildable.barrierColliderIns) {
      // Effectively stops the movement when `boundStatefulBuildable` is pulled up.
      return;
    }
    const self = this;
    const tiledMapIns = self.mapIns.tiledMapIns;
    const mapSizeDiscrete = tiledMapIns.getMapSize();
    const discreteCurrentPos = tileCollisionManager._continuousToDiscrete(self.mapNode, self.mapIns.tiledMapIns, self.node.position, cc.v2(0, 0));
    const discreteCurrentPosKey = window.describe(discreteCurrentPos);

    const referenceGValue = (self.gCache[discreteCurrentPosKey]);
    const referenceGAndHSumValue = (self.gCache[discreteCurrentPosKey] + self._heuristicallyEstimatePathLength(discreteCurrentPos, self.discreteCurrentDestination));

    const theMemberVarName = self._neighbourOffsetToMemberVarName({dx: 0, dy: 0});
    const theLabelNode = new cc.Node(theMemberVarName); 
    const theLabel = theLabelNode.addComponent(cc.Label); 
    theLabel.string = self._cacheValueToString(referenceGValue, referenceGAndHSumValue);

    /*
    * First round.
    *
    * Try to find a neighbour whose "GValue" is strictly higher, and "GAndHSum" is not higher than that of the current grid.
    * Priority goes to "GValue(the higher the better) -> GAndHSum(the lower the better)". 
    */
    let maxG = referenceGValue;
    let associatedGAndHSum = referenceGAndHSumValue;

    let chosenOffsetInDiscreteIsometricCood = null;

    for (let neighbourOffset of window.NEIGHBOUR_DISCRETE_OFFSETS) {
      const discreteNeighbourPos = {
        x: discreteCurrentPos.x + neighbourOffset.dx,
        y: discreteCurrentPos.y + neighbourOffset.dy,
      };

      if (discreteNeighbourPos.x < 0
        ||
        discreteNeighbourPos.x >= mapSizeDiscrete.width
        ||
        discreteNeighbourPos.y < 0
        ||
        discreteNeighbourPos.y >= mapSizeDiscrete.height
      ) {
        continue;
      }
      const discreteNeighbourPosKey = window.describe(discreteNeighbourPos);
      const candidateGValue = self.gCache[discreteNeighbourPosKey];
      const candidateGAndHSumValue = (candidateGValue + self._heuristicallyEstimatePathLength(discreteNeighbourPos, self.discreteCurrentDestination));

      // Updates the labels at "first round".  
      const neighbourOffsetMemberVarName = self._neighbourOffsetToMemberVarName(neighbourOffset);
      const theLabel = self[neighbourOffsetMemberVarName];
      theLabel.string = self._cacheValueToString(candidateGValue, candidateGAndHSumValue);
    
      const canMoveToNonInfiniteG = (INFINITY_FOR_PATH_FINDING <= referenceGValue && INFINITY_FOR_PATH_FINDING > candidateGValue);
      const maxGNeverUpdated = (maxG == referenceGValue); 
      const hasValidNextG = (candidateGValue > referenceGValue && INFINITY_FOR_PATH_FINDING > candidateGValue); 
      const hasValidNextGAndH = (candidateGAndHSumValue <= referenceGAndHSumValue); 

      if (false == (hasValidNextG && hasValidNextGAndH) && false == canMoveToNonInfiniteG) {
        continue;
      }

      /*
      * By far it's definitely sufficed that "INFINITY_FOR_PATH_FINDING > candidateGValue".
      */ 

      if (canMoveToNonInfiniteG && maxGNeverUpdated) {
        // This is put as a "primarily checked case" to update "maxG" as early as possible. 
        maxG = candidateGValue;
        associatedGAndHSum = candidateGAndHSumValue;
        chosenOffsetInDiscreteIsometricCood = neighbourOffset;
      } else if (candidateGValue > maxG) {
        maxG = candidateGValue;
        associatedGAndHSum = candidateGAndHSumValue;
        chosenOffsetInDiscreteIsometricCood = neighbourOffset;
      } else if (candidateGValue == maxG && candidateGAndHSumValue < associatedGAndHSum) {
        associatedGAndHSum = candidateGAndHSumValue;
        chosenOffsetInDiscreteIsometricCood = neighbourOffset;
      } else {
        // Deliberately left blank. -- YFLu 
      }
    }

    if (null == chosenOffsetInDiscreteIsometricCood) {
      /*
      * Proposed Second round.
      *
      * Try to find a neighbour whose "GValue" is strictly higher, and "GAndHSum" is strictly higher than that of the current grid.
      * Priority goes to "GValue(the higher the better) -> GAndHSum(the lower the better)". 
      */
    }

    /*
    // This commented out snippet is to be used for debugging only. 

    if (null == chosenOffsetInDiscreteIsometricCood) {
      const rectifiedContinuousPtInMapNode = tileCollisionManager._continuousFromCentreOfDiscreteTile(self.mapNode, self.mapIns.tiledMapIns, null, discreteCurrentPos.x, discreteCurrentPos.y);
      self.node.setPosition(rectifiedContinuousPtInMapNode); 
      return;
    }
    */

    if (null == chosenOffsetInDiscreteIsometricCood) {
      return;
    }

    const nextDiscretePosition = {x: discreteCurrentPos.x + chosenOffsetInDiscreteIsometricCood.dx, y: discreteCurrentPos.y + chosenOffsetInDiscreteIsometricCood.dy};
    const nextContinuousPtInMapNode = tileCollisionManager._continuousFromCentreOfDiscreteTile(self.mapNode, self.mapIns.tiledMapIns, null, nextDiscretePosition.x, nextDiscretePosition.y);

    const continuousDiffVecInMapNode = nextContinuousPtInMapNode.sub(self.node.position);
    const discretizedDirection = self.mapIns.ctrl.discretizeDirection(continuousDiffVecInMapNode.x, continuousDiffVecInMapNode.y, self.mapIns.ctrl.joyStickEps);
    self.scheduleNewDirection(discretizedDirection);

    const discretizedDirectionMag = Math.sqrt(discretizedDirection.dx * discretizedDirection.dx + discretizedDirection.dy * discretizedDirection.dy);
    const toMoveMag = (self.speed * dt);
    const toMoveX = toMoveMag * (discretizedDirection.dx / discretizedDirectionMag);
    const toMoveY = toMoveMag * (discretizedDirection.dy / discretizedDirectionMag);
    const newPos = self.node.position.add(cc.v2(toMoveX, toMoveY));
    self.node.setPosition(newPos);
  },
});
