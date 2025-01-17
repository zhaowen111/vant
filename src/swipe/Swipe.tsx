import {
  ref,
  watch,
  reactive,
  computed,
  onMounted,
  ComputedRef,
  onActivated,
  CSSProperties,
  onDeactivated,
  onBeforeUnmount,
  defineComponent,
  ExtractPropTypes,
} from 'vue';

// Utils
import {
  range,
  isHidden,
  truthProp,
  preventDefault,
  createNamespace,
  ComponentInstance,
} from '../utils';

// Composables
import {
  doubleRaf,
  useChildren,
  useWindowSize,
  usePageVisibility,
} from '@vant/use';
import { useTouch } from '../composables/use-touch';
import { useExpose } from '../composables/use-expose';

const [name, bem] = createNamespace('swipe');

export const SWIPE_KEY = Symbol(name);

const props = {
  loop: truthProp,
  width: [Number, String],
  height: [Number, String],
  vertical: Boolean,
  touchable: truthProp,
  lazyRender: Boolean,
  indicatorColor: String,
  showIndicators: truthProp,
  stopPropagation: truthProp,
  autoplay: {
    type: [Number, String],
    default: 0,
  },
  duration: {
    type: [Number, String],
    default: 500,
  },
  initialSwipe: {
    type: [Number, String],
    default: 0,
  },
};

export type SwipeToOptions = {
  immediate?: boolean;
};

export type SwipeProvide = {
  props: ExtractPropTypes<typeof props>;
  size: ComputedRef<number>;
  count: ComputedRef<number>;
  activeIndicator: ComputedRef<number>;
};

export default defineComponent({
  name,

  props,

  emits: ['change'],

  setup(props, { emit, slots }) {
    const root = ref<HTMLElement>();
    const state = reactive({
      rect: null as { width: number; height: number } | null,
      width: 0,
      height: 0,
      offset: 0,
      active: 0,
      swiping: false,
    });

    const touch = useTouch();
    const windowSize = useWindowSize();
    const { children, linkChildren } = useChildren<ComponentInstance>(
      SWIPE_KEY
    );

    const count = computed(() => children.length);

    const size = computed(() => state[props.vertical ? 'height' : 'width']);

    const delta = computed(() =>
      props.vertical ? touch.deltaY.value : touch.deltaX.value
    );

    const minOffset = computed(() => {
      if (state.rect) {
        const base = props.vertical ? state.rect.height : state.rect.width;
        return base - size.value * count.value;
      }
      return 0;
    });

    const maxCount = computed(() =>
      Math.ceil(Math.abs(minOffset.value) / size.value)
    );

    const trackSize = computed(() => count.value * size.value);

    const activeIndicator = computed(
      () => (state.active + count.value) % count.value
    );

    const isCorrectDirection = computed(() => {
      const expect = props.vertical ? 'vertical' : 'horizontal';
      return touch.direction.value === expect;
    });

    const trackStyle = computed(() => {
      const style: CSSProperties = {
        transitionDuration: `${state.swiping ? 0 : props.duration}ms`,
        transform: `translate${props.vertical ? 'Y' : 'X'}(${state.offset}px)`,
      };

      if (size.value) {
        const mainAxis = props.vertical ? 'height' : 'width';
        const crossAxis = props.vertical ? 'width' : 'height';
        style[mainAxis] = `${trackSize.value}px`;
        style[crossAxis] = props[crossAxis] ? `${props[crossAxis]}px` : '';
      }

      return style;
    });

    const getTargetActive = (pace: number) => {
      const { active } = state;

      if (pace) {
        if (props.loop) {
          return range(active + pace, -1, count.value);
        }
        return range(active + pace, 0, maxCount.value);
      }
      return active;
    };

    const getTargetOffset = (targetActive: number, offset = 0) => {
      let currentPosition = targetActive * size.value;
      if (!props.loop) {
        currentPosition = Math.min(currentPosition, -minOffset.value);
      }

      let targetOffset = offset - currentPosition;
      if (!props.loop) {
        targetOffset = range(targetOffset, minOffset.value, 0);
      }

      return targetOffset;
    };

    const move = ({
      pace = 0,
      offset = 0,
      emitChange,
    }: {
      pace?: number;
      offset?: number;
      emitChange?: boolean;
    }) => {
      if (count.value <= 1) {
        return;
      }

      const { active } = state;
      const targetActive = getTargetActive(pace);
      const targetOffset = getTargetOffset(targetActive, offset);

      // auto move first and last swipe in loop mode
      if (props.loop) {
        if (children[0] && targetOffset !== minOffset.value) {
          const outRightBound = targetOffset < minOffset.value;
          children[0].setOffset(outRightBound ? trackSize.value : 0);
        }

        if (children[count.value - 1] && targetOffset !== 0) {
          const outLeftBound = targetOffset > 0;
          children[count.value - 1].setOffset(
            outLeftBound ? -trackSize.value : 0
          );
        }
      }

      state.active = targetActive;
      state.offset = targetOffset;

      if (emitChange && targetActive !== active) {
        emit('change', activeIndicator.value);
      }
    };

    const correctPosition = () => {
      state.swiping = true;

      if (state.active <= -1) {
        move({ pace: count.value });
      } else if (state.active >= count.value) {
        move({ pace: -count.value });
      }
    };

    const prev = () => {
      correctPosition();
      touch.reset();

      doubleRaf(() => {
        state.swiping = false;
        move({
          pace: -1,
          emitChange: true,
        });
      });
    };

    const next = () => {
      correctPosition();
      touch.reset();

      doubleRaf(() => {
        state.swiping = false;
        move({
          pace: 1,
          emitChange: true,
        });
      });
    };

    let autoplayTimer: NodeJS.Timeout;

    const stopAutoplay = () => {
      clearTimeout(autoplayTimer);
    };

    const autoplay = () => {
      if (props.autoplay > 0 && count.value > 1) {
        stopAutoplay();
        autoplayTimer = setTimeout(() => {
          next();
          autoplay();
        }, +props.autoplay);
      }
    };

    // initialize swipe position
    const initialize = (active = +props.initialSwipe) => {
      if (!root.value || isHidden(root)) {
        return;
      }

      stopAutoplay();

      const rect = {
        width: root.value.offsetWidth,
        height: root.value.offsetHeight,
      };

      if (count.value) {
        active = Math.min(count.value - 1, active);
      }

      state.rect = rect;
      state.swiping = true;
      state.active = active;
      state.width = +(props.width ?? rect.width);
      state.height = +(props.height ?? rect.height);
      state.offset = getTargetOffset(active);
      children.forEach((swipe) => {
        swipe.setOffset(0);
      });

      autoplay();
    };

    const resize = () => initialize(state.active);

    let touchStartTime: number;

    const onTouchStart = (event: TouchEvent) => {
      if (!props.touchable) return;

      touch.start(event);
      touchStartTime = Date.now();

      stopAutoplay();
      correctPosition();
    };

    const onTouchMove = (event: TouchEvent) => {
      if (props.touchable && state.swiping) {
        touch.move(event);

        if (isCorrectDirection.value) {
          preventDefault(event, props.stopPropagation);
          move({ offset: delta.value });
        }
      }
    };

    const onTouchEnd = () => {
      if (!props.touchable || !state.swiping) {
        return;
      }

      const duration = Date.now() - touchStartTime;
      const speed = delta.value / duration;
      const shouldSwipe =
        Math.abs(speed) > 0.25 || Math.abs(delta.value) > size.value / 2;

      if (shouldSwipe && isCorrectDirection.value) {
        const offset = props.vertical
          ? touch.offsetY.value
          : touch.offsetX.value;

        let pace = 0;

        if (props.loop) {
          pace = offset > 0 ? (delta.value > 0 ? -1 : 1) : 0;
        } else {
          pace = -Math[delta.value > 0 ? 'ceil' : 'floor'](
            delta.value / size.value
          );
        }

        move({
          pace,
          emitChange: true,
        });
      } else if (delta.value) {
        move({ pace: 0 });
      }

      state.swiping = false;
      autoplay();
    };

    const swipeTo = (index: number, options: SwipeToOptions = {}) => {
      correctPosition();
      touch.reset();

      doubleRaf(() => {
        let targetIndex;
        if (props.loop && index === count.value) {
          targetIndex = state.active === 0 ? 0 : index;
        } else {
          targetIndex = index % count.value;
        }

        if (options.immediate) {
          doubleRaf(() => {
            state.swiping = false;
          });
        } else {
          state.swiping = false;
        }

        move({
          pace: targetIndex - state.active,
          emitChange: true,
        });
      });
    };

    const renderDot = (_: number, index: number) => {
      const active = index === activeIndicator.value;
      const style = active
        ? {
            backgroundColor: props.indicatorColor,
          }
        : undefined;

      return <i style={style} class={bem('indicator', { active })} />;
    };

    const renderIndicator = () => {
      if (slots.indicator) {
        return slots.indicator();
      }
      if (props.showIndicators && count.value > 1) {
        return (
          <div class={bem('indicators', { vertical: props.vertical })}>
            {Array(count.value).fill('').map(renderDot)}
          </div>
        );
      }
    };

    useExpose({
      prev,
      next,
      state,
      resize,
      swipeTo,
    });

    linkChildren({
      size,
      props,
      count,
      activeIndicator,
    });

    watch(
      () => props.initialSwipe,
      (value) => initialize(+value)
    );

    watch(count, () => initialize(state.active));

    watch(
      () => props.autoplay,
      (value) => {
        if (value > 0) {
          autoplay();
        } else {
          stopAutoplay();
        }
      }
    );

    watch([windowSize.width, windowSize.height], resize);

    watch(usePageVisibility(), (visible) => {
      if (visible === 'visible') {
        autoplay();
      } else {
        stopAutoplay();
      }
    });

    onMounted(initialize);
    onActivated(() => initialize(state.active));
    onDeactivated(stopAutoplay);
    onBeforeUnmount(stopAutoplay);

    return () => (
      <div ref={root} class={bem()}>
        <div
          style={trackStyle.value}
          class={bem('track', { vertical: props.vertical })}
          onTouchstart={onTouchStart}
          onTouchmove={onTouchMove}
          onTouchend={onTouchEnd}
          onTouchcancel={onTouchEnd}
        >
          {slots.default?.()}
        </div>
        {renderIndicator()}
      </div>
    );
  },
});
