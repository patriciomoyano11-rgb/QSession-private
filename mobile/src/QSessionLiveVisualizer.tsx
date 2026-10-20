import React, {useEffect, useMemo, useRef} from 'react';
import {
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  StyleSheet,
  View,
} from 'react-native';

type Props = {
  active: boolean;
  brandIcon: ImageSourcePropType;
  children?: React.ReactNode;
  level: Animated.Value;
};

const barPeaks = [26, 42, 55, 66, 48, 63, 52, 39, 25];

export function QSessionLiveVisualizer({active, brandIcon, children, level}: Props) {
  const ringOne = useRef(new Animated.Value(0)).current;
  const ringTwo = useRef(new Animated.Value(0)).current;
  const idleMotion = useRef(new Animated.Value(0)).current;
  const barMotions = useRef(barPeaks.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!active) {
      ringOne.setValue(0);
      ringTwo.setValue(0);
      idleMotion.setValue(0);
      barMotions.forEach(value => value.setValue(0));
      return;
    }

    const pulse = (value: Animated.Value, delay: number) => Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, {toValue: 1, duration: 2800, easing: Easing.out(Easing.quad), useNativeDriver: true}),
      Animated.timing(value, {toValue: 0, duration: 0, useNativeDriver: true}),
    ]));
    const animations = [pulse(ringOne, 0), pulse(ringTwo, 1400)];
    const idle = Animated.loop(Animated.sequence([
      Animated.timing(idleMotion, {toValue: 1, duration: 360, easing: Easing.inOut(Easing.sin), useNativeDriver: false}),
      Animated.timing(idleMotion, {toValue: 0, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: false}),
    ]));
    const individualBars = barMotions.map((value, index) => Animated.loop(Animated.sequence([
      Animated.delay((index * 47) % 180),
      Animated.timing(value, {toValue: 1, duration: 170 + (index % 4) * 53, easing: Easing.out(Easing.sin), useNativeDriver: false}),
      Animated.timing(value, {toValue: 0, duration: 230 + ((index + 2) % 5) * 41, easing: Easing.inOut(Easing.sin), useNativeDriver: false}),
    ])));
    animations.forEach(animation => animation.start());
    idle.start();
    individualBars.forEach(animation => animation.start());
    return () => {
      animations.forEach(animation => animation.stop());
      idle.stop();
      individualBars.forEach(animation => animation.stop());
    };
  }, [active, barMotions, idleMotion, ringOne, ringTwo]);

  const visualLevel = useMemo(
    () => Animated.add(level, Animated.multiply(idleMotion, active ? 0.055 : 0)),
    [active, idleMotion, level],
  );
  const ringVisibility = level.interpolate({
    inputRange: [0, 0.08, 0.45, 1],
    outputRange: [0.18, 0.3, 0.58, 0.74],
    extrapolate: 'clamp',
  });
  const ringStyle = (value: Animated.Value) => ({
    opacity: value.interpolate({inputRange: [0, 0.22, 1], outputRange: [0, 0.34, 0], extrapolate: 'clamp'}),
    transform: [{scale: value.interpolate({inputRange: [0, 1], outputRange: [0.9, 1.55]})}],
  });

  return <View style={styles.wrapper} accessibilityLabel="Visualizador del audio en vivo">
    <View style={styles.logoArea}>
      <Animated.View pointerEvents="none" style={[styles.rings, {opacity: ringVisibility}]}>
        <Animated.View style={[styles.ring, ringStyle(ringOne)]}/>
        <Animated.View style={[styles.ring, styles.ringMedium, ringStyle(ringTwo)]}/>
      </Animated.View>
      <Animated.View style={[styles.logoDisc, {transform: [{scale: visualLevel.interpolate({inputRange: [0, 0.2, 1], outputRange: [1, 1.015, 1.045], extrapolate: 'clamp'})}]}]}>
        <Image source={brandIcon} style={styles.logo}/>
      </Animated.View>
    </View>
    {children}
    <View style={styles.bars} accessibilityLabel="Nivel de la música">
      {barPeaks.map((peak, index) => {
        const sensitivity = [0.82, 1.08, 0.94, 1.17, 0.88, 1.12, 0.91, 1.04, 0.79][index];
        const barLevel = Animated.add(
          Animated.multiply(visualLevel, sensitivity),
          Animated.multiply(barMotions[index], active ? 0.13 : 0),
        );
        return <Animated.View key={`${peak}-${index}`} style={[styles.bar, {
        height: barLevel.interpolate({
          inputRange: [0, 0.08, 0.3, 0.7, 1.1],
          outputRange: [6 + (index % 3) * 2, 10 + (index % 4) * 2, peak * 0.55, peak * 0.86, peak],
          extrapolate: 'clamp',
        }),
        opacity: barLevel.interpolate({inputRange: [0, 0.1, 0.45], outputRange: [0.55, 0.72, 1], extrapolate: 'clamp'}),
      }]}/>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrapper:{width:'100%',alignItems:'center',justifyContent:'flex-start',marginBottom:4},
  logoArea:{width:210,height:190,alignItems:'center',justifyContent:'flex-start'},
  rings:{position:'absolute',top:3,width:190,height:190,alignItems:'center',justifyContent:'center'},
  ring:{position:'absolute',width:124,height:124,borderRadius:62,borderWidth:2,borderColor:'#57C9D0'},
  ringMedium:{borderWidth:1.5,borderColor:'#91DCDB'},
  logoDisc:{width:146,height:146,borderRadius:73,backgroundColor:'#E6F4F1',alignItems:'center',justifyContent:'center',marginTop:25},
  logo:{width:104,height:104,resizeMode:'contain'},
  bars:{height:68,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,marginTop:24},
  bar:{width:5,borderRadius:4,backgroundColor:'#57C9D0'},
});
