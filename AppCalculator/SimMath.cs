using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace AppCalculator
{
    public static class SimMath
    {
        public static double Add(double numberOne, double numberTwo)
        {
            return numberOne + numberTwo;
        }
        public static double Minus(double numberOne, double numberTwo)
        {
            return numberOne - numberTwo;
        }
        public static double Multiple(double numberOne, double numberTwo)
        {
            return numberOne * numberTwo;
        }
        public static double Divide(double numberOne, double numberTwo)
        {
            return numberOne / numberTwo;
        }   
    }
}
